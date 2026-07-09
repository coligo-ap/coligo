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
import android.os.SystemClock;
import android.util.Log;
import android.view.View;

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
 *   - puis, tant que la page n'a pas peint, une BARRE DE CHARGEMENT sous la
 *     marque, et la marque respire. Jamais d'écran figé : un écran figé, pour
 *     l'utilisateur, c'est une application plantée.
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
    public static final long ENTRANCE_MS = (long) (SHINE_DELAY + SHINE_DUR);
    private static final long EXIT_MS = 340;

    private final Bitmap bmp;
    private final Paint base = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG);
    private final Paint shinePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint blobPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint glowPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint arcOuter = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint arcInner = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint barPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Rect markRect = new Rect();
    private final RectF ovalOuter = new RectF();
    private final RectF ovalInner = new RectF();
    private final RectF barRect = new RectF();

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

        // --- barre de chargement ------------------------------------------------
        // Elle n'apparaît QUE si l'attente se prolonge : afficher un indicateur
        // pour 200 ms agiterait l'écran pour rien.
        float wait = t - ENTRANCE_MS;
        if (wait > 0) drawLoadingBar(canvas, seg(wait, 120, 260), now);

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

    /** Piste + segment lumineux qui balaie : « ça charge », sans ambiguïté. */
    private void drawLoadingBar(Canvas c, float a, long now) {
        if (a <= 0.004f) return;
        float w = markW * 0.44f;
        float h = 3f * density;
        float left = cx - w / 2f;
        float top = cy + markH * 0.78f;

        barPaint.setShader(null);
        barPaint.setColor(Color.WHITE);
        barPaint.setAlpha(Math.round(38 * a));
        barRect.set(left, top, left + w, top + h);
        c.drawRoundRect(barRect, h, h, barPaint);

        float u = (now % 1250L) / 1250f;
        float segW = w * 0.36f;
        float x = left - segW + easeInOut(u) * (w + segW);
        float x0 = Math.max(left, x);
        float x1 = Math.min(left + w, x + segW);
        if (x1 <= x0) return;
        barPaint.setAlpha(Math.round(235 * a));
        barRect.set(x0, top, x1, top + h);
        c.drawRoundRect(barRect, h, h, barPaint);
    }
}
