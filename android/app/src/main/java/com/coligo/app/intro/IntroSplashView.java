package com.coligo.app.intro;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
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
 *   - LE CIRCUIT : une route qui défile sous la marque, parcourue par un convoi
 *     qui raconte Coligo dans l'ordre — le commerçant prépare (fruits, boissons,
 *     sac kraft), le livreur file (scooter), le client attend, Drive le déplace
 *     (voiture), il gagne du cashback (pièce, seul élément à l'accent rose).
 *     Il tourne tant que la page n'a pas peint : c'est aussi l'indicateur de
 *     chargement. Un écran qui bouge dit « je charge » ; un écran figé dit
 *     « j'ai planté ».
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

    /**
     * Le parcours Coligo, dans l'ordre de l'histoire : le commerçant prépare
     * (fruits, boissons, sac kraft), le livreur file (scooter), le client
     * attend, Coligo Drive le déplace (voiture), et il gagne du cashback.
     */
    private static final int[] CONVOY = {
        R.drawable.ic_intro_apple,
        R.drawable.ic_intro_drink,
        R.drawable.ic_intro_bag,
        R.drawable.ic_intro_bike,
        R.drawable.ic_intro_person,
        R.drawable.ic_intro_car,
        R.drawable.ic_intro_coin,
    };

    private final Bitmap bmp;
    private final Paint base = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG);
    private final Paint shinePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint blobPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint glowPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint arcOuter = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint arcInner = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint roadPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Drawable[] convoy;
    /** Accent rose de marque, réservé au cashback. */
    private final ColorFilter roseTint =
        new PorterDuffColorFilter(0xFFFF2D7A, PorterDuff.Mode.SRC_IN);
    /** Dégradé de la route, construit une fois la largeur connue. */
    private LinearGradient roadShader;
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

        // Icônes du convoi : VectorDrawable générés depuis lucide
        // (scripts/lucide-to-vector.mjs). Chargés une fois, dessinés au Canvas.
        convoy = new Drawable[CONVOY.length];
        for (int i = 0; i < CONVOY.length; i++) {
            try {
                convoy[i] = ContextCompat.getDrawable(context, CONVOY[i]);
            } catch (Throwable t) {
                Log.e(TAG, "icone convoi " + i + " illisible", t);
            }
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

        Log.i(TAG, "taille " + w + "x" + h + " markW=" + markW);
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

        // --- le circuit Coligo ---------------------------------------------------
        drawCircuit(canvas, t, now);

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
     * Le circuit : une route qui défile, et le convoi qui la parcourt.
     *
     * C'est aussi l'indicateur de chargement. Il n'attend pas la fin de
     * l'entrée pour apparaître — la route se pose pendant que « oligo » se
     * dévoile — et il continue de tourner tant que la page n'a pas peint. Un
     * écran qui bouge dit « je charge » ; un écran figé dit « j'ai planté ».
     *
     * Le convoi raconte Coligo dans l'ordre : le commerçant prépare (fruits,
     * boissons, sac kraft), le livreur file (scooter), le client attend, Drive
     * le déplace (voiture), il gagne du cashback (pièce). Puis ça recommence.
     */
    private void drawCircuit(Canvas c, float t, long now) {
        float roadA = seg(t, ROAD_DELAY, ROAD_DUR);
        if (roadA <= 0.004f) return;

        float roadW = Math.min(getWidth() * 0.80f, 340f * density);
        float left = cx - roadW / 2f;
        float right = cx + roadW / 2f;
        float y = cy + markH * 0.98f;
        float icon = 23f * density;

        // La route s'ESTOMPE aux deux bouts au lieu de se couper net : sans ce
        // dégradé, les tirets s'arrêtent d'un coup et le convoi surgit du vide.
        if (roadShader == null) {
            roadShader = new LinearGradient(left, 0, right, 0,
                new int[] { 0x00FFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0x00FFFFFF },
                new float[] { 0f, 0.16f, 0.84f, 1f }, Shader.TileMode.CLAMP);
        }
        roadPaint.setShader(roadShader);

        // Un trait continu très discret, et des tirets qui défilent — c'est le
        // défilement qui donne la vitesse, pas les icônes.
        roadPaint.setStrokeWidth(1.6f * density);
        roadPaint.setAlpha(Math.round(30 * roadA));
        c.drawLine(left, y, right, y, roadPaint);

        float dash = 9f * density;
        float gap = 11f * density;
        float phase = ((now % 780L) / 780f) * (dash + gap);
        roadPaint.setStrokeWidth(2f * density);
        roadPaint.setAlpha(Math.round(76 * roadA));
        for (float x = left - (dash + gap) + phase; x < right; x += dash + gap) {
            float x0 = Math.max(left, x);
            float x1 = Math.min(right, x + dash);
            if (x1 > x0) c.drawLine(x0, y, x1, y, roadPaint);
        }
        roadPaint.setShader(null);

        float convoyA = seg(t, CONVOY_DELAY, CONVOY_FADE);
        if (convoyA <= 0.004f) return;

        // Le convoi : assez serré pour qu'on lise l'histoire d'un coup d'œil
        // (trois à quatre éléments visibles à la fois), assez lent pour qu'on
        // reconnaisse chaque icône.
        float spacing = roadW / 3.3f;
        float total = spacing * convoy.length;
        float speed = 62f * density / 1000f; // px par ms
        float offset = ((t - CONVOY_DELAY) * speed) % total;

        for (int i = 0; i < convoy.length; i++) {
            Drawable d = convoy[i];
            if (d == null) continue;
            float x = left - spacing + ((i * spacing + offset) % total);
            if (x < left - icon || x > right + icon) continue;

            // Fondu aux deux bouts, calé sur celui de la route.
            float edge = roadW * 0.16f;
            float a = Math.min(1f, Math.min(x - left, right - x) / edge);
            if (a <= 0.02f) continue;

            // Chacun rebondit à son rythme : le convoi respire, il ne glisse pas.
            float bob = -1.7f * density * (float) Math.abs(Math.sin(now / 250.0 + i * 1.7));

            // Le cashback est la récompense : seul élément à l'accent rose.
            d.setColorFilter(CONVOY[i] == R.drawable.ic_intro_coin ? roseTint : null);

            int half = Math.round(icon / 2f);
            int bottom = Math.round(y + bob) - Math.round(3 * density);
            d.setBounds(Math.round(x) - half, bottom - Math.round(icon),
                Math.round(x) + half, bottom);
            d.setAlpha(Math.round(238 * a * convoyA));
            d.draw(c);
        }
    }
}
