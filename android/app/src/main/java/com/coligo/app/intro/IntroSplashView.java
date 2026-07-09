package com.coligo.app.intro;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.DashPathEffect;
import android.graphics.LinearGradient;
import android.graphics.Path;
import android.graphics.PathMeasure;
import android.graphics.Paint;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffColorFilter;
import android.graphics.PorterDuffXfermode;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.drawable.Drawable;
import android.os.SystemClock;
import android.util.Log;
import android.view.View;

import androidx.core.content.ContextCompat;

import com.coligo.app.R;

/**
 * Intro de marque NATIVE — UNE SEULE VUE qui dessine tout au Canvas.
 *
 * <h2>Ce qu'elle raconte</h2>
 * Une commande Coligo, du comptoir à la porte, en moins de deux secondes et
 * demie. Le commerçant emballe (le colis naît sur la boutique), la voiture
 * arrive, se charge, le feu passe au vert, elle file, prend le virage à 90° du
 * coin de l'écran, et se gare devant chez le client. Le repère tombe. Rien
 * d'autre n'apparaît : ni étoile, ni part de pizza, ni burger. Chaque objet à
 * l'écran est un maillon de cette phrase-là.
 *
 * <h2>Direction artistique</h2>
 * Fond BLANC. Bâtiments gris clair, goudron noir, marquage blanc, arbres verts,
 * un feu tricolore. Le violet Coligo ne sert qu'aux acteurs de l'histoire —
 * boutique, voiture, porte du client, colis. Sur un décor gris neutre, l'œil
 * suit la seule couleur saturée : il suit donc le récit, sans qu'on ait besoin
 * de le pointer.
 *
 * <h2>Pourquoi natif, et pourquoi une seule vue</h2>
 * L'intro web ne pouvait démarrer qu'APRÈS le premier paint de la page distante
 * — elle AJOUTAIT son temps au chargement. Ici elle démarre à t=0 et tourne
 * PENDANT que la WebView télécharge et exécute la page : les deux se
 * superposent, et l'app est prête pile quand l'animation s'achève.
 *
 * Une première version empilait des vues enfants et un {@code AnimatorSet}. Sur
 * un vrai téléphone (Xiaomi, Android 16) rien ne s'affichait, sans la moindre
 * exception dans logcat. Il ne reste ici que {@code drawPath}, {@code drawBitmap},
 * {@code clipRect}, {@code saveLayer} et des shaders — et des logs.
 *
 * L'horloge est {@link SystemClock#uptimeMillis()}, pas un {@code ValueAnimator} :
 * l'intro est donc IMMUNISÉE au réglage « échelle de durée des animations » du
 * système. À 0 — fréquent sur MIUI et en économie de batterie — tous les
 * animateurs sautent directement à leur état final.
 *
 * <h2>Géométrie</h2>
 * Un seul {@link Path} porte toute la scène : la route. Elle entre par la
 * gauche, file droit, tourne à 90° par un arc, puis descend. Les acteurs sont
 * placés par abscisse curviligne ({@link PathMeasure}) et orientés sur la
 * TANGENTE — la voiture ne « tourne » pas parce qu'on l'a dessinée de travers,
 * elle tourne parce que la route tourne. La même mesure sert à faire POUSSER le
 * goudron au début ({@code getSegment}) : une seule source de vérité.
 *
 * Repères mesurés sur coligo_wordmark.png (800×275) : le « C » occupe les
 * colonnes 0→162 ; son centre optique est à 10,13 % en x, 43,09 % en y. Le PNG
 * est un aplat BLANC ; sur fond blanc il serait invisible, on le TEINTE en
 * violet avec un {@code SRC_IN} — la lettre garde sa forme, elle change d'encre.
 */
public class IntroSplashView extends View {

    private static final String TAG = "ColigoIntro";

    /**
     * Le raccord. Doit rester égal à @color/coligo_splash et à
     * `android.backgroundColor` (capacitor.config.ts + scripts/build-client-aab.mjs).
     * Du tap sur l'icône à la première frame de l'animation, une seule couleur.
     */
    private static final int SEAM = 0xFFFFFFFF;

    // Palette — la même que scripts/coligo-illustrations.mjs.
    private static final int VIOLET = 0xFF6C2BD9;
    private static final int VIOLET_D = 0xFF4B1FA6;
    private static final int ASPHALT = 0xFF16181D;
    private static final int SIDEWALK = 0xFFF1F3F7;
    private static final int MARKING = 0xFFFFFFFF;
    private static final int TYRE = 0xFF1F2228;
    private static final int LAMP_OFF = 0xFF2E3238;
    private static final int LAMP_RED = 0xFFFF4D4F;
    private static final int LAMP_AMBER = 0xFFFFC53D;
    private static final int LAMP_GREEN = 0xFF23C87E;
    private static final int POLE = 0xFFB9C2CC;
    private static final int SHADOW = 0x0F000000;

    private static final float RATIO = 800f / 275f;
    private static final float C_X = 0.1013f;
    private static final float C_Y = 0.4309f;
    private static final float C_RIGHT = 0.2005f;
    private static final float SHIFT = 0.5f - C_X;
    private static final float ZOOM = 1.62f;
    private static final float VEIL = 0.86f;

    // La chaussée, en dp. Elle a été élargie de 62 à 70 : à 62, une voiture de
    // 26 dp de large laissait 2 dp de marge de part et d'autre de sa voie, et
    // ses rétroviseurs mordaient le marquage central.
    private static final float ROAD_W = 70f;
    private static final float WALK_HALF = 46f;
    private static final float CORNER_R = 52f;
    /** Milieu de la voie de droite : c'est là que roule la voiture. */
    private static final float LANE = 17.5f;

    // ------------------------------------------------------------ chronologie
    // Tout est simultané ou presque : le logo se révèle PENDANT que la route se
    // trace et que la ville se lève. Une intro qui enchaîne ses actes bout à
    // bout est une intro qui dure trois fois trop longtemps.
    private static final float MARK_IN = 360f;
    private static final float SETTLE_DELAY = 300f, SETTLE_DUR = 400f;
    private static final float SHINE_DELAY = 620f, SHINE_DUR = 460f;

    private static final float ROAD_DELAY = 100f, ROAD_DUR = 560f;
    private static final float DASH_DELAY = 500f, DASH_DUR = 280f;
    private static final float CITY_DELAY = 240f, CITY_STEP = 55f, CITY_DUR = 340f;
    private static final float SHOP_DELAY = 480f, SHOP_DUR = 260f;
    private static final float HOUSE_DELAY = 560f, HOUSE_DUR = 280f;
    private static final float LIGHT_DELAY = 640f, LIGHT_DUR = 220f;

    private static final float PARCEL_DELAY = 700f, PARCEL_DUR = 220f;
    private static final float CAR_IN_DELAY = 760f, CAR_IN_DUR = 290f;
    /**
     * Le colis ne part qu'une fois la voiture À QUAI (elle s'arrête à 1050) :
     * sinon il vole vers une place vide et retombe dans le vide. L'ordre des
     * gestes est ce qui fait qu'on lit une histoire plutôt qu'une liste
     * d'animations.
     */
    private static final float LOAD_DELAY = 1060f, LOAD_DUR = 170f;
    /** Le feu passe au vert AVANT le départ : c'est lui qui autorise la course. */
    private static final float GREEN_AT = 1190f;
    private static final float TRIP_DELAY = 1250f, TRIP_DUR = 740f;
    private static final float PIN_DELAY = 2000f, PIN_DUR = 210f;

    /**
     * Durée de l'animation. Le contrat produit est « moins de 2,5 s, tout
     * compris » : 2220 ms d'animation + 230 ms de fondu = 2450 ms. Pendant ce
     * temps la WebView charge derrière ; l'overlay ne se retire que lorsque les
     * DEUX sont prêts (cf. MainActivity), donc l'app apparaît sans transition.
     */
    public static final long ENTRANCE_MS = 2220;
    private static final long EXIT_MS = 230;

    /** Après l'entrée, si la page tarde : trois points. On ne fige jamais l'écran. */
    private static final float DOTS_IN = 260f;

    private final Bitmap bmp;
    private final Paint base = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG);
    private final Paint shinePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint sidewalk = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint asphalt = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint marking = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint flat = new Paint(Paint.ANTI_ALIAS_FLAG);

    /**
     * Les acteurs. La voiture est dessinée SANS ses pneus : un VectorDrawable se
     * dessine d'un bloc, impossible d'animer une seule de ses formes — or les
     * roues avant doivent braquer. Le Canvas les pose lui-même.
     */
    private Drawable dCarTop;
    private Drawable dShop, dHouse, dParcel, dPin;
    private Drawable dBuildingA, dBuildingB, dBuildingC, dTree;

    /** La route. Un seul contour : moveTo → lineTo → arcTo → lineTo. */
    private final Path route = new Path();
    private final Path revealed = new Path();
    private final PathMeasure routeMeasure = new PathMeasure();
    private final RectF corner = new RectF();
    private final RectF oval = new RectF();
    private final Rect markRect = new Rect();
    private final float[] pos = new float[2];
    private final float[] tan = new float[2];
    /** Second point de lecture du tracé : sert à mesurer le braquage. */
    private final float[] pos2 = new float[2];
    private final float[] tan2 = new float[2];

    private float routeLen, shopStop, carStop;
    private float roadY, cornerX;
    private float shopX, shopFootY, cityFootY;
    private float houseX, houseFootY, lightX, lightFootY;

    private long startMs;
    private long exitStartMs;
    private boolean dismissed;
    private boolean detached;
    private boolean entranceReported;
    private Runnable onEntranceDone;
    private Runnable onRemoved;

    private int markW, markH, cx, markCy;
    private final float density;

    /**
     * Le décor D'ARRIÈRE-PLAN, derrière la chaussée. Les immeubles d'abord, les
     * arbres ensuite : posé dans cet ordre, un arbre passe devant un immeuble et
     * la rue prend de l'épaisseur.
     * { fraction de largeur, taille en dp, type } — type : 0=A 1=B 2=C 3=arbre.
     */
    private static final float[][] CITY = {
        { 0.050f, 104f, 0f },
        { 0.400f, 86f, 1f },
        { 0.520f, 108f, 2f },
        { 0.290f, 62f, 3f },
        { 0.468f, 52f, 3f },
    };

    /**
     * Le PREMIER PLAN : deux arbres en deçà de la chaussée. Sans eux, tout le
     * bas-gauche de l'écran est un aplat blanc, et la rue n'a qu'un seul côté.
     * { fraction de largeur, taille en dp, distance sous le trottoir en dp }
     */
    private static final float[][] NEAR = {
        { 0.105f, 58f, 54f },
        { 0.300f, 46f, 76f },
    };

    public IntroSplashView(Context context) {
        super(context);
        setClickable(true);
        setFocusable(true);
        density = context.getResources().getDisplayMetrics().density;

        Bitmap b = null;
        try {
            b = BitmapFactory.decodeResource(context.getResources(), R.drawable.coligo_wordmark);
        } catch (Throwable t) {
            Log.e(TAG, "wordmark illisible", t);
        }
        bmp = b;
        Log.i(TAG, "wordmark " + (bmp == null ? "ABSENT" : bmp.getWidth() + "x" + bmp.getHeight()));

        // Le PNG est blanc. SRC_IN remplace l'encre et garde la forme et l'alpha :
        // la lettre devient violette, ses bords restent lissés.
        base.setColorFilter(new PorterDuffColorFilter(VIOLET, PorterDuff.Mode.SRC_IN));
        shinePaint.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.SRC_ATOP));

        sidewalk.setStyle(Paint.Style.STROKE);
        sidewalk.setStrokeCap(Paint.Cap.BUTT);
        sidewalk.setColor(SIDEWALK);
        asphalt.setStyle(Paint.Style.STROKE);
        asphalt.setStrokeCap(Paint.Cap.BUTT);
        asphalt.setColor(ASPHALT);
        marking.setStyle(Paint.Style.STROKE);
        marking.setStrokeCap(Paint.Cap.BUTT);
        marking.setColor(MARKING);

        dCarTop = load(context, R.drawable.ic_illu_car_top);
        dShop = load(context, R.drawable.ic_illu_shop);
        dHouse = load(context, R.drawable.ic_illu_house);
        dParcel = load(context, R.drawable.ic_illu_parcel);
        dPin = load(context, R.drawable.ic_illu_pin);
        dBuildingA = load(context, R.drawable.ic_illu_building_a);
        dBuildingB = load(context, R.drawable.ic_illu_building_b);
        dBuildingC = load(context, R.drawable.ic_illu_building_c);
        dTree = load(context, R.drawable.ic_illu_tree);
    }

    private static Drawable load(Context c, int res) {
        try {
            return ContextCompat.getDrawable(c, res);
        } catch (Throwable t) {
            Log.e(TAG, "illustration " + res + " illisible", t);
            return null;
        }
    }

    /** Démarre l'horloge. `onDone` est appelé quand l'entrée est terminée. */
    public void play(Runnable onDone) {
        this.onEntranceDone = onDone;
        startMs = SystemClock.uptimeMillis();
        Log.i(TAG, "intro demarree");
        postInvalidateOnAnimation();
    }

    /** Sortie en fondu, puis retrait du parent. Idempotent. */
    public void dismiss(Runnable removed) {
        if (dismissed) return;
        dismissed = true;
        this.onRemoved = removed;
        exitStartMs = SystemClock.uptimeMillis();
        Log.i(TAG, "sortie apres " + (exitStartMs - startMs) + " ms");
        postInvalidateOnAnimation();
    }

    /** Retrait IMMÉDIAT, sans fondu. */
    public void remove() {
        dismissed = true;
        detach();
    }

    public boolean isDismissed() {
        return dismissed;
    }

    private void detach() {
        if (detached) return;
        detached = true;
        if (getParent() instanceof android.view.ViewGroup) {
            ((android.view.ViewGroup) getParent()).removeView(this);
        }
        if (bmp != null && !bmp.isRecycled()) bmp.recycle();
        if (onRemoved != null) {
            Runnable r = onRemoved;
            onRemoved = null;
            r.run();
        }
    }

    @Override
    protected void onSizeChanged(int w, int h, int ow, int oh) {
        super.onSizeChanged(w, h, ow, oh);
        if (w == 0 || h == 0) return;
        cx = w / 2;
        markCy = Math.round(h * 0.30f);
        markW = Math.round(Math.min(w * 0.62f, 300f * density));
        markH = Math.round(markW / RATIO);
        markRect.set(0, 0, markW, markH);

        buildRoute(w, h);

        shopX = w * 0.165f;
        // Le pied du décor est au BORD ARRIÈRE du trottoir : les immeubles sont
        // derrière la chaussée, pas dessus.
        cityFootY = roadY - halfSidewalk() + 2f * density;
        shopFootY = cityFootY;

        // La maison est CONTRE le trottoir de la voie descendante, à hauteur du
        // point d'arrêt : la voiture se gare devant sa porte, pas dans la rue
        // d'à côté.
        float houseSize = 88f * density;
        routeMeasure.getPosTan(carStop, pos, tan);
        houseFootY = pos[1] + 15f * density;
        houseX = cornerX - halfSidewalk() - houseSize / 2f + 6f * density;

        // Le feu se dresse à l'angle OPPOSÉ du carrefour — de l'autre côté de la
        // voie descendante. L'angle intérieur, plus évident, est déjà occupé par
        // la maison : le mât retombait sur son toit. Ici il tient le seul pan de
        // décor encore vide, et il reste face au conducteur qui arrive.
        lightX = cornerX + halfSidewalk() + 12f * density;
        lightFootY = roadY + halfSidewalk() + 24f * density;

        Log.i(TAG, "taille " + w + "x" + h + " markW=" + markW
            + " route=" + Math.round(routeLen) + " arret=" + Math.round(carStop));
    }

    private float halfSidewalk() {
        return WALK_HALF * density;
    }

    /**
     * LA ROUTE. Elle entre hors champ à gauche, file droit sous la marque, puis
     * tourne à 90° par un arc de rayon fixe et descend vers le coin bas-droit.
     *
     * Le départ est franchement hors écran (-0,22 W) pour que la voiture ait où
     * exister avant d'entrer : {@code getPosTan} BORNE la distance à [0, len],
     * une abscisse négative renverrait donc le point de départ et la voiture
     * apparaîtrait, immobile, collée au bord.
     */
    private void buildRoute(int w, int h) {
        roadY = h * 0.655f;
        cornerX = w * 0.725f;
        float r = CORNER_R * density;

        route.reset();
        route.moveTo(-0.22f * w, roadY);
        route.lineTo(cornerX - r, roadY);
        // Centre de l'arc : (cornerX - r, roadY + r). De -90° (le haut du cercle,
        // donc le point courant) à 0° (sa droite) : le cap passe de « vers l'est »
        // à « vers le sud ». Exactement 90°.
        corner.set(cornerX - 2f * r, roadY, cornerX, roadY + 2f * r);
        route.arcTo(corner, -90f, 90f, false);
        route.lineTo(cornerX, h * 0.945f);

        routeMeasure.setPath(route, false);
        routeLen = routeMeasure.getLength();

        // Sur le segment droit, l'abscisse curviligne EST l'abscisse écran.
        shopStop = (w * 0.165f + 12f * density) - (-0.22f * w);
        // Assez haut pour que la voiture garée reste ENTIÈRE dans le cadre : à
        // 30 dp du bout, elle était coupée par le bas de l'écran.
        carStop = routeLen - 92f * density;
    }

    // --- courbes ------------------------------------------------------------
    /** Progression [0,1] d'un segment temporel. */
    private static float seg(float t, float delay, float dur) {
        float u = (t - delay) / dur;
        return u < 0 ? 0 : (u > 1 ? 1 : u);
    }

    /** Sortie « ressort », proche de cubic-bezier(0.16,1,0.3,1). */
    private static float easeOut(float u) {
        float v = 1 - u;
        return 1 - v * v * v * v * v;
    }

    /** Expressif, proche de cubic-bezier(0.65,0,0.1,1). */
    private static float easeExpressive(float u) {
        return u < 0.5f
            ? 4f * u * u * u
            : 1f - (float) Math.pow(-2f * u + 2f, 3) / 2f;
    }

    private static float easeInOut(float u) {
        return 0.5f - 0.5f * (float) Math.cos(Math.PI * u);
    }

    /** Léger dépassement : ce qui apparaît « pose » au lieu de surgir. */
    private static float easeBack(float u) {
        float c = 1.70158f, c3 = c + 1f, v = u - 1f;
        return 1f + c3 * v * v * v + c * v * v;
    }

    private static float lerp(float a, float b, float u) {
        return a + (b - a) * u;
    }

    @Override
    protected void onDraw(Canvas canvas) {
        if (detached) return;
        long now = SystemClock.uptimeMillis();
        float t = startMs == 0 ? 0 : now - startMs;

        if (dismissed) {
            float a = 1f - (now - exitStartMs) / (float) EXIT_MS;
            if (a <= 0f) {
                detach();
                return;
            }
            setAlpha(a);
        }

        // Le fond est peint dès la toute première frame. Jamais d'écran nu.
        canvas.drawColor(SEAM);

        if (bmp == null || bmp.isRecycled() || markW == 0) {
            // Pas de marque : on garde au moins la scène, jamais un écran mort.
            // Et la trace est dans logcat.
            drawScene(canvas, t, now);
            postInvalidateOnAnimation();
            return;
        }

        drawWordmark(canvas, t);
        drawScene(canvas, t, now);
        drawDots(canvas, t, now);

        if (!entranceReported && t >= ENTRANCE_MS) {
            entranceReported = true;
            Log.i(TAG, "entree terminee");
            if (onEntranceDone != null) onEntranceDone.run();
        }
        postInvalidateOnAnimation();
    }

    /**
     * Le « C » naît seul et centré, grandit, puis GLISSE à sa place pendant que le
     * clip s'ouvre et dévoile « oligo ». Un SEUL calque, un seul bitmap.
     */
    private void drawWordmark(Canvas canvas, float t) {
        float markA = easeOut(seg(t, 0, MARK_IN));
        float scale, tx, clipRight;
        if (t < SETTLE_DELAY) {
            scale = ZOOM * (0.88f + 0.12f * easeOut(seg(t, 0, MARK_IN)));
            tx = markW * SHIFT;
            clipRight = markW * C_RIGHT;
        } else {
            float u = easeExpressive(seg(t, SETTLE_DELAY, SETTLE_DUR));
            scale = ZOOM + (1f - ZOOM) * u;
            tx = markW * SHIFT * (1f - u);
            clipRight = markW * (C_RIGHT + (1f - C_RIGHT) * u);
        }
        // Respiration pendant l'attente réseau : la marque vit.
        if (t > ENTRANCE_MS) {
            scale *= 1f + 0.008f * (float) Math.sin((t - ENTRANCE_MS) / 480.0);
        }
        float veil = VEIL + (1f - VEIL) * seg(t, 700, 300);
        float shine = -0.35f + 1.70f * easeInOut(seg(t, SHINE_DELAY, SHINE_DUR));

        canvas.save();
        canvas.translate(cx - markW / 2f + tx, markCy - markH / 2f);
        canvas.translate(markW * C_X, markH * C_Y);
        canvas.scale(scale, scale);
        canvas.translate(-markW * C_X, -markH * C_Y);
        canvas.clipRect(0, 0, clipRight, markH);

        // Couche isolée : sans elle, SRC_ATOP composerait sur le fond opaque et
        // inonderait l'écran de blanc au lieu de n'éclairer que les lettres.
        int layer = canvas.saveLayer(0, 0, markW, markH, null);
        base.setAlpha(Math.round(255 * veil * markA));
        canvas.drawBitmap(bmp, null, markRect, base);
        if (shine > -0.34f && shine < 1.34f) {
            float band = markW * 0.20f, sx = shine * markW;
            shinePaint.setShader(new LinearGradient(sx - band, 0, sx + band, 0,
                new int[] { 0x00FFFFFF, 0x8CFFFFFF, 0x00FFFFFF },
                new float[] { 0f, 0.5f, 1f }, Shader.TileMode.CLAMP));
            canvas.drawRect(0, 0, markW, markH, shinePaint);
        }
        canvas.restoreToCount(layer);
        canvas.restore();
    }

    // ------------------------------------------------------------------ scène

    private void drawScene(Canvas c, float t, long now) {
        if (routeLen <= 0f) return;
        drawRoad(c, t);
        drawCity(c, t);
        drawShop(c, t);
        drawNear(c, t);
        drawHouse(c, t);
        drawTrafficLight(c, t);
        drawCar(c, t);
        drawParcel(c, t);
        drawPin(c, t, now);
    }

    /**
     * Le goudron POUSSE depuis la gauche : {@code getSegment} découpe la route à
     * l'abscisse atteinte. Trottoir, chaussée et marquage partagent le même
     * tronçon — ils ne peuvent pas se désynchroniser.
     */
    private void drawRoad(Canvas c, float t) {
        float p = easeExpressive(seg(t, ROAD_DELAY, ROAD_DUR));
        if (p <= 0.001f) return;

        revealed.reset();
        if (!routeMeasure.getSegment(0f, routeLen * p, revealed, true)) return;

        sidewalk.setStrokeWidth(halfSidewalk() * 2f);
        c.drawPath(revealed, sidewalk);

        asphalt.setStrokeWidth(ROAD_W * density);
        c.drawPath(revealed, asphalt);

        float dashA = seg(t, DASH_DELAY, DASH_DUR);
        if (dashA <= 0.004f) return;
        float dash = 15f * density, gap = 13f * density;
        marking.setStrokeWidth(3.2f * density);
        marking.setAlpha(Math.round(235 * dashA));
        marking.setPathEffect(new DashPathEffect(new float[] { dash, gap }, 0f));
        c.drawPath(revealed, marking);
        marking.setPathEffect(null);
    }

    /** Les immeubles et les arbres se lèvent, décalés les uns des autres. */
    private void drawCity(Canvas c, float t) {
        for (int i = 0; i < CITY.length; i++) {
            float a = seg(t, CITY_DELAY + i * CITY_STEP, CITY_DUR);
            if (a <= 0.004f) continue;
            Drawable d;
            switch ((int) CITY[i][2]) {
                case 0: d = dBuildingA; break;
                case 1: d = dBuildingB; break;
                case 2: d = dBuildingC; break;
                default: d = dTree; break;
            }
            float size = CITY[i][1] * density;
            float rise = (1f - easeOut(a)) * 18f * density;
            drawActor(c, d, getWidth() * CITY[i][0], cityFootY + rise, size, 0f,
                Math.round(255 * a));
        }
    }

    /** Les arbres du premier plan, en deçà de la chaussée. */
    private void drawNear(Canvas c, float t) {
        for (int i = 0; i < NEAR.length; i++) {
            float a = seg(t, CITY_DELAY + (CITY.length + i) * CITY_STEP, CITY_DUR);
            if (a <= 0.004f) continue;
            float size = NEAR[i][1] * density;
            float foot = roadY + halfSidewalk() + NEAR[i][2] * density;
            float rise = (1f - easeOut(a)) * 14f * density;
            float x = getWidth() * NEAR[i][0];
            groundShadow(c, x, foot, size * 0.5f, a);
            drawActor(c, dTree, x, foot + rise, size, 0f, Math.round(255 * a));
        }
    }

    /** POINT A. Le commerçant. */
    private void drawShop(Canvas c, float t) {
        float a = seg(t, SHOP_DELAY, SHOP_DUR);
        if (a <= 0.004f) return;
        float size = 100f * density * lerp(0.86f, 1f, easeBack(a));
        groundShadow(c, shopX, shopFootY, size * 0.82f, a);
        drawActor(c, dShop, shopX, shopFootY, size, 0f, Math.round(255 * a));
    }

    /** POINT B. Le client. */
    private void drawHouse(Canvas c, float t) {
        float a = seg(t, HOUSE_DELAY, HOUSE_DUR);
        if (a <= 0.004f) return;
        float size = 88f * density * lerp(0.86f, 1f, easeBack(a));
        groundShadow(c, houseX, houseFootY, size * 0.80f, a);
        drawActor(c, dHouse, houseX, houseFootY, size, 0f, Math.round(255 * a));
    }

    /**
     * Le feu. Rouge, puis vert — et un jaune de 110 ms entre les deux, sans quoi
     * la bascule ressemble à un bug d'affichage plutôt qu'à un feu.
     */
    private void drawTrafficLight(Canvas c, float t) {
        float a = seg(t, LIGHT_DELAY, LIGHT_DUR);
        if (a <= 0.004f) return;
        int alpha = Math.round(255 * a);
        float rise = (1f - easeOut(a)) * 12f * density;
        float baseY = lightFootY + rise;

        float poleW = 3.2f * density, poleH = 24f * density;
        float boxW = 14f * density, boxH = 26f * density;

        flat.setColor(POLE);
        flat.setAlpha(alpha);
        oval.set(lightX - poleW / 2f, baseY - poleH, lightX + poleW / 2f, baseY);
        c.drawRoundRect(oval, poleW / 2f, poleW / 2f, flat);

        flat.setColor(ASPHALT);
        flat.setAlpha(alpha);
        float boxBottom = baseY - poleH + 2f * density;
        oval.set(lightX - boxW / 2f, boxBottom - boxH, lightX + boxW / 2f, boxBottom);
        c.drawRoundRect(oval, 3.4f * density, 3.4f * density, flat);

        int lit;
        if (t < GREEN_AT - 110f) lit = 0;
        else if (t < GREEN_AT) lit = 1;
        else lit = 2;

        float r = 3.4f * density;
        for (int i = 0; i < 3; i++) {
            float ly = boxBottom - boxH + (i + 0.5f) * (boxH / 3f);
            flat.setColor(i != lit ? LAMP_OFF
                : (i == 0 ? LAMP_RED : i == 1 ? LAMP_AMBER : LAMP_GREEN));
            flat.setAlpha(alpha);
            c.drawCircle(lightX, ly, r, flat);
        }
    }

    /**
     * LA VOITURE. Elle entre hors champ, s'arrête devant la boutique le temps du
     * chargement, repart au vert, prend le virage et se gare.
     *
     * Le cap vient de la TANGENTE de la route : dans l'arc, la voiture pivote
     * réellement de 90°, parce que la route tourne. Et les roues AVANT braquent :
     * on relit le cap un empattement plus loin sur le tracé, l'écart est l'angle
     * de braquage. Sur la ligne droite il vaut zéro tout seul ; dans l'arc il se
     * cale sur la courbure. C'est ce détail — plus que la rotation — qui fait
     * qu'on voit une voiture tourner plutôt qu'une image pivoter.
     */
    private void drawCar(Canvas c, float t) {
        if (t < CAR_IN_DELAY) return;
        float dist;
        if (t < CAR_IN_DELAY + CAR_IN_DUR) {
            dist = lerp(0f, shopStop, easeOut(seg(t, CAR_IN_DELAY, CAR_IN_DUR)));
        } else if (t < TRIP_DELAY) {
            dist = shopStop;
        } else {
            dist = lerp(shopStop, carStop, easeInOut(seg(t, TRIP_DELAY, TRIP_DUR)));
        }
        if (!routeMeasure.getPosTan(dist, pos, tan)) return;

        float size = 78f * density;
        float k = size / 48f;
        float heading = (float) Math.toDegrees(Math.atan2(tan[1], tan[0]));

        float wheelbase = 23f * k;
        float steer = 0f;
        if (routeMeasure.getPosTan(Math.min(dist + wheelbase, routeLen), pos2, tan2)) {
            float ahead = (float) Math.toDegrees(Math.atan2(tan2[1], tan2[0]));
            float d = ahead - heading;
            while (d > 180f) d -= 360f;
            while (d < -180f) d += 360f;
            steer = Math.max(-32f, Math.min(32f, d));
        }

        c.save();
        c.translate(pos[0], pos[1]);
        c.rotate(heading);
        // Le tracé passe au MILIEU de la chaussée : il faut se ranger dans une
        // voie. Le décalage est appliqué APRÈS la rotation, donc en +Y LOCAL,
        // c'est-à-dire toujours à droite du sens de marche : sous l'axe quand on
        // va vers l'est, à gauche de l'axe quand on descend vers le sud. Une
        // seule constante donne la conduite à droite sur les deux tronçons — et
        // gare la voiture du bon côté, celui de la maison. En -Y (la version
        // précédente) elle roulait sur le trottoir, puis sortait de la route au
        // sortir du virage.
        c.translate(0f, LANE * density);

        // Les pneus D'ABORD : la carrosserie les recouvre à moitié, il ne dépasse
        // que ce qui doit dépasser.
        drawTyre(c, -10.5f * k, -8.4f * k, k, 0f);
        drawTyre(c, -10.5f * k, 8.4f * k, k, 0f);
        drawTyre(c, 12.5f * k, -8.4f * k, k, steer);
        drawTyre(c, 12.5f * k, 8.4f * k, k, steer);

        if (dCarTop != null) {
            int half = Math.round(size / 2f);
            dCarTop.setBounds(-half, -half, half, half);
            dCarTop.setAlpha(255);
            dCarTop.draw(c);
        }
        c.restore();
    }

    /** Un pneu vu de dessus : un rectangle arrondi sombre, qui peut braquer. */
    private void drawTyre(Canvas c, float x, float y, float k, float deg) {
        c.save();
        c.translate(x, y);
        if (deg != 0f) c.rotate(deg);
        float hw = 3.6f * k, hh = 2.0f * k;
        oval.set(-hw, -hh, hw, hh);
        flat.setColor(TYRE);
        flat.setAlpha(255);
        c.drawRoundRect(oval, 1.6f * k, 1.6f * k, flat);
        c.restore();
    }

    /**
     * LE COLIS. Il naît sur la boutique — le commerçant vient de l'emballer —
     * puis file dans la voiture en cloche. Passé le chargement, il n'existe
     * plus : il est dans le coffre.
     */
    private void drawParcel(Canvas c, float t) {
        if (t < PARCEL_DELAY || t > LOAD_DELAY + LOAD_DUR) return;
        float size = 40f * density;
        float x0 = shopX + 26f * density;
        float y0 = shopFootY - 96f * density;

        float a = seg(t, PARCEL_DELAY, PARCEL_DUR);
        float scale = lerp(0.5f, 1f, easeBack(a));

        float x = x0, y = y0;
        float u = seg(t, LOAD_DELAY, LOAD_DUR);
        if (u > 0f) {
            routeMeasure.getPosTan(shopStop, pos, tan);
            // La voiture est rangée une demi-voie SOUS l'axe : viser l'axe ferait
            // tomber le colis sur le marquage, à côté d'elle. On vise son toit.
            float x1 = pos[0], y1 = pos[1] + LANE * density;
            x = lerp(x0, x1, u);
            y = lerp(y0, y1, u) - 26f * density * (float) Math.sin(u * Math.PI);
            scale *= lerp(1f, 0.55f, u); // il s'éloigne en tombant dans le coffre
        } else {
            y += 3f * density * (float) Math.sin(a * Math.PI); // il se pose
        }
        drawActor(c, dParcel, x, y, size * scale, 0f, Math.round(255 * a));
    }

    /** Le repère tombe sur la maison, puis pulse doucement tant qu'on attend. */
    private void drawPin(Canvas c, float t, long now) {
        float a = seg(t, PIN_DELAY, PIN_DUR);
        if (a <= 0.004f) return;
        float size = 34f * density;
        // L'APEX du toit, pas le haut de la boîte : la maison culmine à y=5,6 de
        // sa boîte 48×48. Viser le haut de la boîte laissait le repère flotter
        // dix points au-dessus du faîte.
        float top = houseFootY - 88f * density * (1f - 5.6f / 48f);
        float y = lerp(top - 32f * density, top - 3f * density, easeBack(a));
        float pulse = t > ENTRANCE_MS
            ? 1f + 0.05f * (float) Math.sin((t - ENTRANCE_MS) / 260.0)
            : 1f;
        drawActor(c, dPin, houseX, y, size * pulse, 0f, Math.round(255 * a));
    }

    /**
     * Trois points sous la marque. Ils n'apparaissent QUE si la page se fait
     * attendre au-delà de l'animation : un écran qui bouge dit « je charge », un
     * écran figé dit « j'ai planté ».
     */
    private void drawDots(Canvas c, float t, long now) {
        if (t <= ENTRANCE_MS) return;
        float a = seg(t, ENTRANCE_MS, DOTS_IN);
        float y = markCy + markH * 0.5f + 30f * density;
        float r = 3.4f * density, gapX = 13f * density;
        for (int i = 0; i < 3; i++) {
            double ph = (now / 220.0) - i * 0.6;
            float bob = 0.5f + 0.5f * (float) Math.sin(ph);
            flat.setColor(VIOLET_D);
            flat.setAlpha(Math.round(255 * a * (0.28f + 0.72f * bob)));
            c.drawCircle(cx + (i - 1) * gapX, y, r * (0.82f + 0.18f * bob), flat);
        }
    }

    // ------------------------------------------------------------------ outils

    /** Une ellipse à peine visible : elle pose l'objet au sol au lieu de le laisser flotter. */
    private void groundShadow(Canvas c, float x, float yFoot, float w, float a) {
        flat.setColor(SHADOW);
        flat.setAlpha(Math.round(Color.alpha(SHADOW) * a));
        oval.set(x - w / 2f, yFoot - 3f * density, x + w / 2f, yFoot + 3f * density);
        c.drawOval(oval, flat);
    }

    /**
     * Dessine une illustration dont le PIED est au point donné (le dessin pose
     * sur y=44 de sa boîte 48×48), tournée de `deg` autour de ce pied.
     */
    private void drawActor(Canvas c, Drawable d, float x, float yFoot, float size,
                           float deg, int alpha) {
        if (d == null || alpha <= 2) return;
        c.save();
        c.translate(x, yFoot);
        if (deg != 0f) c.rotate(deg);
        c.translate(0, size * (4f / 48f));
        int half = Math.round(size / 2f);
        d.setBounds(-half, -Math.round(size), half, 0);
        d.setAlpha(Math.min(255, alpha));
        d.draw(c);
        c.restore();
    }
}
