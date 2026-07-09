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
import android.graphics.PorterDuffXfermode;
import android.graphics.RadialGradient;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.ColorFilter;
import android.graphics.PorterDuffColorFilter;
import android.graphics.drawable.Drawable;
import android.os.SystemClock;
import android.util.Log;
import android.view.View;

import androidx.core.content.ContextCompat;

import com.coligo.app.R;

/**
 * Intro de marque NATIVE — UNE SEULE VUE qui dessine tout au Canvas.
 *
 * Pourquoi une seule vue. La première version empilait des vues enfants
 * (ImageView + halo + arcs), modifiait leurs `LayoutParams` PENDANT le layout du
 * parent, s'appuyait sur `setClipBounds` et sur un `AnimatorSet`. Sur un vrai
 * téléphone (Xiaomi, Android 16) rien ne s'affichait : fond violet, aucune
 * marque, et aucune exception dans logcat. Trop de mécanismes, aucun observable.
 * Il ne reste ici que `drawBitmap`, `clipRect`, `saveLayer`, `drawArc` et des
 * shaders — et des logs.
 *
 * L'horloge est `SystemClock.uptimeMillis()`, pas un ValueAnimator : l'intro est
 * donc IMMUNISÉE au réglage « échelle de durée des animations » du système. À 0
 * — fréquent sur MIUI et en économie de batterie — tous les animateurs sautent
 * directement à leur état final.
 *
 * La scène :
 *   - fond #4C1B9B, identique au windowBackground et au fond de la WebView ;
 *   - deux nappes de couleur qui dérivent ;
 *   - un halo violet SATURÉ (jamais de blanc : sur ce fond il désature) ;
 *   - deux arcs en orbite qui tracent autour du « C » ;
 *   - le « C » naît, grandit, puis GLISSE à sa place pendant que le clip s'ouvre
 *     et dévoile « oligo » — un seul calque ;
 *   - un reflet spéculaire traverse les lettres, composé en SRC_ATOP dans une
 *     couche isolée : il n'éclaire QUE la matière des lettres ;
 *   - L'ITINÉRAIRE : une vraie route goudronnée, ligne médiane en pointillés qui
 *     défile, qui ondule sous la marque puis part en virage vers le haut à
 *     droite. Sept illustrations plates la parcourent et racontent Coligo dans
 *     l'ordre : le commerçant prépare (pizza, boisson, sac kraft), le livreur
 *     file (scooter), le client attend, Drive le déplace (voiture), il gagne du
 *     cashback (pièce qui tourne). Chacune s'oriente sur la TANGENTE du tracé :
 *     dans le virage, le scooter penche vraiment. Le circuit tourne tant que la
 *     page n'a pas peint — c'est aussi l'indicateur de chargement. Un écran qui
 *     bouge dit « je charge » ; un écran figé dit « j'ai planté ».
 *
 * Repères mesurés sur coligo_wordmark.png (800×275) : le « C » occupe les
 * colonnes 0→162 ; son centre optique est à 10,13 % en x, 43,09 % en y.
 */
public class IntroSplashView extends View {

    private static final String TAG = "ColigoIntro";

    /** Doit rester égal à @color/coligo_splash et à --seam côté CSS. */
    private static final int SEAM = 0xFF4C1B9B;

    private static final float RATIO = 800f / 275f;
    private static final float C_X = 0.1013f;
    private static final float C_Y = 0.4309f;
    private static final float C_RIGHT = 0.2005f;
    private static final float SHIFT = 0.5f - C_X;
    private static final float ZOOM = 1.62f;
    private static final float VEIL = 0.86f;

    // Chronologie de l'entrée, en millisecondes.
    private static final float MARK_IN = 560f;
    private static final float ARCS_DELAY = 40f, ARCS_DUR = 760f;
    private static final float SETTLE_DELAY = 580f, SETTLE_DUR = 500f;
    private static final float SHINE_DELAY = 860f, SHINE_DUR = 520f;

    // Le circuit : la route apparaît pendant que « oligo » se dévoile, et le
    // convoi démarre juste après. On ne fait pas attendre pour l'animation, on
    // l'installe PENDANT le reste de l'entrée.
    private static final float ROAD_DELAY = 880f, ROAD_DUR = 420f;
    private static final float CONVOY_DELAY = 980f, CONVOY_FADE = 420f;

    /**
     * Durée minimale à l'écran. Elle couvre l'entrée (1380 ms) PLUS une mesure
     * de convoi, pour qu'on le voie vraiment même quand la page arrive vite.
     * Au-delà, l'intro ne dure que ce que dure le chargement.
     */
    public static final long ENTRANCE_MS = 1900;
    private static final long EXIT_MS = 340;



    private final Bitmap bmp;
    private final Paint base = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG);
    private final Paint shinePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint blobPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint glowPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint arcOuter = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint arcInner = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint roadPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    // Les acteurs de la scène. Les véhicules sont DÉCOMPOSÉS (carrosserie /
    // roue) : un VectorDrawable se dessine d'un bloc, impossible d'animer une
    // seule de ses formes. Sans ça, pas de roues qui tournent.
    private Drawable dCarBody, dScooterBody, dWheel, dBag;
    private Drawable dPizza, dBurger, dFries, dCoffee, dPin, dStar;
    private Drawable dBuildingA, dBuildingB, dTree;
    private final Paint steamPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path steamPath = new Path();
    /** Ombre portée : elle pose les objets sur la route au lieu de les laisser flotter. */
    private final Paint shadowPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF shadowRect = new RectF();
    /** Dégradé de la route, construit une fois la largeur connue. */
    private LinearGradient roadShader;
    /** L'itineraire : deux courbes de Bezier, de la gauche vers le virage haut-droite. */
    private final Path route = new Path();
    private final PathMeasure routeMeasure = new PathMeasure();
    private float routeLen;
    private final float[] pos = new float[2];
    private final float[] tan = new float[2];
    private final Paint asphalt = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint kerb = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint centerLine = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Rect markRect = new Rect();
    private final RectF ovalOuter = new RectF();
    private final RectF ovalInner = new RectF();

    private long startMs;
    private long exitStartMs;
    private boolean dismissed;
    private boolean detached;
    private boolean entranceReported;
    private Runnable onEntranceDone;
    private Runnable onRemoved;

    private int markW, markH, cx, cy, glowR, arcR;
    private float dy;
    private final float density;

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

        shinePaint.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.SRC_ATOP));
        arcOuter.setStyle(Paint.Style.STROKE);
        arcOuter.setStrokeCap(Paint.Cap.ROUND);
        arcInner.setStyle(Paint.Style.STROKE);
        arcInner.setStrokeCap(Paint.Cap.ROUND);
        arcInner.setColor(0xD9C4A5FF);

        roadPaint.setStyle(Paint.Style.STROKE);
        roadPaint.setStrokeCap(Paint.Cap.ROUND);
        roadPaint.setColor(Color.WHITE);

        // Goudron : une bande sombre, un lisere plus clair dessous pour le
        // relief, et une ligne mediane blanche en pointilles qui defile.
        kerb.setStyle(Paint.Style.STROKE);
        kerb.setStrokeCap(Paint.Cap.ROUND);
        kerb.setColor(0xFF3A2C63);
        asphalt.setStyle(Paint.Style.STROKE);
        asphalt.setStrokeCap(Paint.Cap.ROUND);
        asphalt.setColor(0xFF241A45);
        centerLine.setStyle(Paint.Style.STROKE);
        centerLine.setStrokeCap(Paint.Cap.BUTT);
        centerLine.setColor(0xFFFFFFFF);

        // Illustrations de la scène : VectorDrawable générés par
        // scripts/coligo-illustrations.mjs. Chargés une fois.
        dCarBody = load(context, R.drawable.ic_illu_car_body);
        dScooterBody = load(context, R.drawable.ic_illu_scooter_body);
        dWheel = load(context, R.drawable.ic_illu_wheel);
        dBag = load(context, R.drawable.ic_illu_deliverybag);
        dPizza = load(context, R.drawable.ic_illu_pizza);
        dBurger = load(context, R.drawable.ic_illu_burger);
        dFries = load(context, R.drawable.ic_illu_fries);
        dCoffee = load(context, R.drawable.ic_illu_coffee);
        dPin = load(context, R.drawable.ic_illu_pin);
        dStar = load(context, R.drawable.ic_illu_star);
        dBuildingA = load(context, R.drawable.ic_illu_building_a);
        dBuildingB = load(context, R.drawable.ic_illu_building_b);
        dTree = load(context, R.drawable.ic_illu_tree);

        steamPaint.setStyle(Paint.Style.STROKE);
        steamPaint.setStrokeCap(Paint.Cap.ROUND);
        steamPaint.setColor(Color.WHITE);
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
        cy = h / 2;
        markW = Math.round(Math.min(w * 0.66f, 296f * density));
        markH = Math.round(markW / RATIO);
        markRect.set(0, 0, markW, markH);
        dy = markH * (C_Y - 0.5f);
        glowR = Math.round(Math.min(w * 0.80f, 320f * density) / 2f);
        arcR = Math.round(Math.min(w * 0.58f, 224f * density) / 2f);

        arcOuter.setStrokeWidth(2.4f * density);
        arcInner.setStrokeWidth(1.3f * density);
        ovalOuter.set(cx - arcR, cy + dy - arcR, cx + arcR, cy + dy + arcR);
        float ri = arcR * 0.82f;
        ovalInner.set(cx - ri, cy + dy - ri, cx + ri, cy + dy + ri);
        arcOuter.setShader(new LinearGradient(
            cx - arcR, cy - arcR, cx + arcR, cy + arcR,
            new int[] { 0x00FF2D7A, 0xF2FF2D7A, 0xE6FFFFFF },
            new float[] { 0f, 0.55f, 1f }, Shader.TileMode.CLAMP));
        glowPaint.setShader(new RadialGradient(cx, cy + dy, glowR,
            new int[] { 0x4DC48CFF, 0x42A86DFF, 0x29FF2D7A, 0x00000000 },
            new float[] { 0f, 0.32f, 0.56f, 1f }, Shader.TileMode.CLAMP));

        buildRoute(w, h);
        Log.i(TAG, "taille " + w + "x" + h + " markW=" + markW + " route=" + Math.round(routeLen));
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

        // --- nappes, dérive lente -------------------------------------------
        float d1 = (float) Math.sin(now / 2600.0);
        float d2 = (float) Math.cos(now / 3100.0);
        float big = Math.max(getWidth(), getHeight());
        drawBlob(canvas, getWidth() * 0.18f + d1 * 14f * density,
            getHeight() * 0.22f + d2 * 10f * density, big * 0.62f,
            0x8CFF2D7A, seg(t, 0, 700));
        drawBlob(canvas, getWidth() * 0.86f - d1 * 12f * density,
            getHeight() * 0.84f - d2 * 14f * density, big * 0.66f,
            0x998A4DFF, seg(t, 0, 900));

        if (bmp == null || bmp.isRecycled() || markW == 0) {
            // Pas de marque : on garde au moins le fond animé, jamais un écran
            // mort. Et la trace est dans logcat.
            postInvalidateOnAnimation();
            return;
        }

        // --- halo -------------------------------------------------------------
        float glowA = easeOut(seg(t, 0, 420)) * (1f - seg(t, 600, 360));
        if (glowA > 0.004f) {
            glowPaint.setAlpha(Math.round(255 * glowA));
            canvas.drawCircle(cx, cy + dy, glowR, glowPaint);
        }

        // --- arcs en orbite ---------------------------------------------------
        float p = easeOut(seg(t, ARCS_DELAY, ARCS_DUR));
        float arcA = seg(t, ARCS_DELAY, 220) * (1f - seg(t, 600, 280));
        if (arcA > 0.004f) {
            arcOuter.setAlpha(Math.round(255 * arcA));
            arcInner.setAlpha(Math.round(217 * arcA));
            canvas.drawArc(ovalOuter, -90f + 360f * p, -300f * p, false, arcOuter);
            canvas.drawArc(ovalInner, 90f - 300f * p, 120f * p, false, arcInner);
        }

        // --- la marque --------------------------------------------------------
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
            scale *= 1f + 0.010f * (float) Math.sin((t - ENTRANCE_MS) / 480.0);
        }
        float veil = VEIL + (1f - VEIL) * seg(t, 940, 300);
        float shine = -0.35f + 1.70f * easeInOut(seg(t, SHINE_DELAY, SHINE_DUR));

        canvas.save();
        canvas.translate(cx - markW / 2f + tx, cy - markH / 2f);
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
            float band = markW * 0.22f, sx = shine * markW;
            shinePaint.setShader(new LinearGradient(sx - band, 0, sx + band, 0,
                new int[] { 0x00FFFFFF, 0xFFFFFFFF, 0x00FFFFFF },
                new float[] { 0f, 0.5f, 1f }, Shader.TileMode.CLAMP));
            canvas.drawRect(0, 0, markW, markH, shinePaint);
        }
        canvas.restoreToCount(layer);
        canvas.restore();

        // --- la scène (ville, route, véhicules, gourmandises) --------------------
        drawScene(canvas, t, now);

        if (!entranceReported && t >= ENTRANCE_MS) {
            entranceReported = true;
            Log.i(TAG, "entree terminee");
            if (onEntranceDone != null) onEntranceDone.run();
        }
        postInvalidateOnAnimation();
    }

    private void drawBlob(Canvas c, float x, float y, float r, int core, float a) {
        if (a <= 0.004f) return;
        // L'arrêt intermédiaire garde la TEINTE et ne change que l'alpha :
        // `core & 0x33FFFFFF` donnerait une alpha nulle (0x8C & 0x33 == 0).
        int mid = (core & 0x00FFFFFF) | 0x3B000000;
        int edge = core & 0x00FFFFFF;
        blobPaint.setShader(new RadialGradient(x, y, r,
            new int[] { core, mid, edge }, new float[] { 0f, 0.5f, 1f },
            Shader.TileMode.CLAMP));
        blobPaint.setAlpha(Math.round(255 * a));
        c.drawCircle(x, y, r, blobPaint);
    }

    /**
     * L'ITINÉRAIRE. Une route qui entre par la gauche, ondule sous la marque,
     * puis part en virage vers le haut à droite — comme un tracé de navigation.
     *
     * Deux cubiques suffisent : une pour l'ondulation, une pour le virage. On la
     * mesure une fois (`PathMeasure`) et on y place les objets par abscisse
     * curviligne. Chacun s'oriente sur la TANGENTE : le scooter penche
     * réellement dans le virage, il n'est pas simplement dessiné de travers.
     */
    private void buildRoute(int w, int h) {
        // Assez bas pour que les toits de la ville passent SOUS le wordmark :
        // avec y0 = 1.30 * markH, les immeubles recouvraient le « o ».
        float y0 = cy + markH * 1.78f;
        float span = 112f * density;

        route.reset();
        route.moveTo(-0.08f * w, y0 + 0.10f * span);
        route.cubicTo(
            0.18f * w, y0 + 0.30f * span,
            0.34f * w, y0 - 0.26f * span,
            0.56f * w, y0 - 0.14f * span);
        route.cubicTo(
            0.76f * w, y0 - 0.04f * span,
            0.96f * w, y0 - 0.30f * span,
            1.03f * w, y0 - 1.05f * span);
        routeMeasure.setPath(route, false);
        routeLen = routeMeasure.getLength();
    }

    /**
     * LA SCÈNE. Un décor de dessin animé, composé, pas un tas d'objets.
     *
     * Trois plans, du fond vers l'avant :
     *   1. la ville — immeubles et arbres alignés derrière la route, qui
     *      dérivent en PARALLAXE (plus lentement que les véhicules) ;
     *   2. la chaussée — goudron, liseré, ligne médiane en pointillés qui
     *      défile ; c'est le défilement qui donne la vitesse ;
     *   3. les véhicules — la voiture Drive emmène un client (visible à la
     *      vitre), le scooter du livreur porte son sac. Leurs ROUES TOURNENT
     *      vraiment : l'angle vient de la distance parcourue divisée par le
     *      rayon, comme une roue qui roule sans glisser.
     *
     * Et autour, les gourmandises, chacune dans son coin, chacune avec sa
     * micro-animation : la pizza pivote, le burger rebondit, les frites sautent,
     * le café fume, le pin GPS rebondit, les étoiles d'avis scintillent.
     *
     * Tout tourne tant que la page n'a pas peint : c'est aussi l'indicateur de
     * chargement. Un écran qui bouge dit « je charge » ; un écran figé dit
     * « j'ai planté ».
     */
    private void drawScene(Canvas c, float t, long now) {
        float roadA = seg(t, ROAD_DELAY, ROAD_DUR);
        if (roadA <= 0.004f || routeLen <= 0f) return;

        float travel = (t - ROAD_DELAY) * (92f * density / 1000f); // px parcourus

        drawCity(c, roadA, travel);
        drawRoad(c, roadA, now);

        float actorsA = seg(t, CONVOY_DELAY, CONVOY_FADE);
        if (actorsA > 0.004f) {
            drawVehicles(c, actorsA, travel, now);
            drawProps(c, actorsA, t, now);
        }
    }

    /** Plan lointain : la ville derrière la route, en parallaxe. */
    private void drawCity(Canvas c, float a, float travel) {
        float drift = travel * 0.28f; // la ville défile 3,5× moins vite
        int count = 9;
        float step = routeLen / count;
        for (int i = 0; i < count; i++) {
            float dist = (i * step + drift) % routeLen;
            if (!routeMeasure.getPosTan(dist, pos, tan)) continue;
            float x = pos[0], y = pos[1];
            if (x < -140 * density || x > getWidth() + 140 * density) continue;

            float edgeA = Math.min(1f, Math.min(dist, routeLen - dist) / (routeLen * 0.08f));
            int alpha = Math.round(255 * a * edgeA);
            if (alpha <= 2) continue;

            // Un arbre sur trois : la ville respire, elle n'est pas un mur.
            Drawable d;
            float size;
            switch (i % 3) {
                case 0: d = dBuildingA; size = 74f * density; break;
                case 1: d = dTree;      size = 46f * density; break;
                default: d = dBuildingB; size = 62f * density; break;
            }
            if (d == null) continue;
            // Posé derrière la chaussée, décalé vers le haut d'une demi-largeur.
            drawActor(c, d, x, y - 16f * density, size, 0f, alpha);
        }
    }

    /** Le goudron et sa ligne médiane. */
    private void drawRoad(Canvas c, float a, long now) {
        kerb.setStrokeWidth(34f * density);
        kerb.setAlpha(Math.round(255 * a));
        c.drawPath(route, kerb);

        asphalt.setStrokeWidth(29f * density);
        asphalt.setAlpha(Math.round(255 * a));
        c.drawPath(route, asphalt);

        float dash = 13f * density, gap = 15f * density;
        float phase = -((now % 1000L) / 1000f) * (dash + gap);
        centerLine.setStrokeWidth(2.4f * density);
        centerLine.setAlpha(Math.round(130 * a));
        centerLine.setPathEffect(new DashPathEffect(new float[] { dash, gap }, phase));
        c.drawPath(route, centerLine);
        centerLine.setPathEffect(null);
    }

    /** La voiture et le scooter, roues en rotation, orientés sur la tangente. */
    private void drawVehicles(Canvas c, float a, float travel, long now) {
        drawVehicle(c, a, (travel) % routeLen, now, true);
        drawVehicle(c, a, (travel + routeLen * 0.42f) % routeLen, now, false);
    }

    private void drawVehicle(Canvas c, float a, float dist, long now, boolean isCar) {
        if (!routeMeasure.getPosTan(dist, pos, tan)) return;
        float x = pos[0], y = pos[1];
        float size = (isCar ? 78f : 72f) * density;
        if (x < -size || x > getWidth() + size) return;

        float edgeA = Math.min(1f, Math.min(dist, routeLen - dist) / (routeLen * 0.07f));
        float alpha = a * edgeA;
        if (alpha <= 0.02f) return;

        float angle = (float) Math.toDegrees(Math.atan2(tan[1], tan[0]));
        float bob = -1.1f * density * (float) Math.abs(Math.sin(now / 190.0));

        c.save();
        c.translate(x, y);
        c.rotate(angle);

        // ombre au sol
        shadowPaint.setColor(0xFF0E0626);
        shadowPaint.setAlpha(Math.round(110 * alpha));
        shadowRect.set(-size * 0.32f, -10.6f * density, size * 0.32f, -5.4f * density);
        c.drawOval(shadowRect, shadowPaint);

        // Le trace passe au MILIEU de la bande de goudron. Les roues doivent
        // toucher sa surface, pas sa moelle : on remonte d'une demi-chaussee.
        c.translate(0, bob - 11f * density);

        // Repères pris dans la boîte 48×48 de l'illustration : les roues du
        // dessin sont en (14,37)/(35,37) pour la voiture, (14.5,37)/(36.5,37)
        // pour le scooter. On les redessine à part, tournantes.
        float k = size / 48f;
        float wr = (isCar ? 5.6f : 6.3f) * k;               // rayon à l'écran
        float wheelSize = wr * (48f / 21f);                  // la roue fait r=21 dans sa boîte
        float spin = (float) Math.toDegrees(travelSpin(now, wr));

        Drawable body = isCar ? dCarBody : dScooterBody;
        float w1 = (isCar ? 14f : 14.5f) * k - size / 2f;
        float w2 = (isCar ? 35f : 36.5f) * k - size / 2f;
        // Le pied du dessin (y=44) est à y=0. Un point de la boîte se projette
        // donc en (yBox - 44) * k. Avec  les roues montaient de 4
        // unités et disparaissaient derrière la carrosserie.
        float wy = (37f - 44f) * k;

        drawWheel(c, w1, wy, wheelSize, spin, Math.round(255 * alpha));
        drawWheel(c, w2, wy, wheelSize, spin, Math.round(255 * alpha));
        drawActor(c, body, 0f, 0f, size, 0f, Math.round(255 * alpha));

        // Le sac du livreur se BALANCE sur son support arrière.
        if (!isCar && dBag != null) {
            // Il pend au porte-bagages arrière et se balance autour de son
            // point d'accroche — pas autour de son centre, sinon il patine.
            float bx = (5.5f - 24f) * k;
            float by = (20f - 44f) * k;
            float swing = 5f * (float) Math.sin(now / 300.0);
            float bs = 19f * k;
            c.save();
            c.translate(bx, by);
            c.rotate(swing);
            dBag.setBounds(Math.round(-bs / 2f), 0, Math.round(bs / 2f), Math.round(bs));
            dBag.setAlpha(Math.round(255 * alpha));
            dBag.draw(c);
            c.restore();
        }
        c.restore();
    }

    /** Angle de roulement : distance parcourue / rayon. Une roue qui ne glisse pas. */
    private float travelSpin(long now, float radius) {
        float travelled = (now % 100000L) * (92f * density / 1000f);
        return travelled / Math.max(radius, 1f);
    }

    /** Les gourmandises, chacune dans son coin, chacune avec sa vie propre. */
    private void drawProps(Canvas c, float a, float t, long now) {
        int W = getWidth(), H = getHeight();
        float big = 62f * density;

        // pizza — elle pivote de quelques degrés, lentement
        drawActor(c, dPizza, W * 0.16f, H * 0.20f, big,
            7f * (float) Math.sin(now / 900.0), Math.round(255 * a));

        // burger — il rebondit
        float bounce = -5f * density * Math.abs((float) Math.sin(now / 420.0));
        drawActor(c, dBurger, W * 0.85f, H * 0.18f + bounce, big, 0f, Math.round(255 * a));

        // frites — elles sautent, plus haut et plus sec
        float jump = -9f * density * Math.abs((float) Math.sin(now / 350.0));
        drawActor(c, dFries, W * 0.13f, H * 0.34f + jump, big * 0.92f, 0f, Math.round(255 * a));

        // café — immobile, mais il fume
        float cx0 = W * 0.87f, cy0 = H * 0.33f;
        drawActor(c, dCoffee, cx0, cy0, big * 0.92f, 0f, Math.round(255 * a));
        drawSteam(c, cx0, cy0 - big * 0.78f, now, a);

        // pin GPS — il rebondit au-dessus de la route
        float pinBounce = -7f * density * Math.abs((float) Math.sin(now / 480.0));
        drawActor(c, dPin, W * 0.82f, cy + markH * 1.16f + pinBounce, big * 0.78f, 0f,
            Math.round(255 * a));

        // étoiles d'avis — elles APPARAISSENT après la livraison, en cascade
        for (int i = 0; i < 3; i++) {
            float appear = seg(t, CONVOY_DELAY + 260 + i * 180, 380);
            if (appear <= 0.01f) continue;
            float pop = easeOut(appear);
            float twinkle = 0.88f + 0.12f * (float) Math.sin(now / 260.0 + i * 2.1);
            float s = big * 0.42f * pop * twinkle;
            drawActor(c, dStar, W * (0.38f + i * 0.12f), H * 0.115f, s,
                -12f + i * 12f, Math.round(255 * a * appear));
        }
    }

    /** Trois volutes qui montent et s'effacent. */
    private void drawSteam(Canvas c, float x, float yTop, long now, float a) {
        steamPaint.setStrokeWidth(2.6f * density);
        for (int i = 0; i < 3; i++) {
            float u = (((now + i * 520L) % 1560L) / 1560f);
            float rise = 26f * density * u;
            int alpha = Math.round(150 * a * (1f - u) * Math.min(1f, u * 4f));
            if (alpha <= 2) continue;
            steamPaint.setAlpha(alpha);
            float bx = x + (i - 1) * 8f * density;
            steamPath.reset();
            steamPath.moveTo(bx, yTop - rise);
            steamPath.rQuadTo(5f * density, -6f * density, 0f, -12f * density);
            steamPath.rQuadTo(-5f * density, -6f * density, 0f, -12f * density);
            c.drawPath(steamPath, steamPaint);
        }
    }

    /** La roue est CENTRÉE dans sa boîte : elle tourne autour de son moyeu. */
    private void drawWheel(Canvas c, float x, float y, float size, float deg, int alpha) {
        if (dWheel == null || alpha <= 2) return;
        c.save();
        c.translate(x, y);
        c.rotate(deg);
        int half = Math.round(size / 2f);
        dWheel.setBounds(-half, -half, half, half);
        dWheel.setAlpha(Math.min(255, alpha));
        dWheel.draw(c);
        c.restore();
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
        float foot = size * (4f / 48f);
        c.translate(0, foot);
        int half = Math.round(size / 2f);
        d.setBounds(-half, -Math.round(size), half, 0);
        d.setAlpha(Math.min(255, alpha));
        d.draw(c);
        c.restore();
    }

}
