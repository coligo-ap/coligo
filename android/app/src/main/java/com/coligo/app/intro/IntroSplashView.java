package com.coligo.app.intro;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.AnimatorSet;
import android.animation.ObjectAnimator;
import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.animation.LinearInterpolator;
import android.view.animation.PathInterpolator;
import android.widget.FrameLayout;

import com.coligo.app.R;

/**
 * Intro de marque NATIVE, dessinée par-dessus la WebView.
 *
 * Pourquoi natif : l'intro web ne pouvait démarrer qu'APRÈS le premier paint de
 * la page distante (~1 à 2,5 s de réseau + SSR), elle ajoutait donc sa durée au
 * chargement. Ici l'animation démarre à t=0 et tourne PENDANT que la WebView
 * charge derrière. Un seul écran, sans couture, et l'app apparaît plus tôt.
 *
 * La scène, dans l'ordre où l'œil la lit :
 *   - fond APLAT #4C1B9B — pas un dégradé : c'est aussi le windowBackground et
 *     la barre de statut, donc aucun liseré en haut de l'écran ;
 *   - deux nappes de couleur (rose, violet clair) qui dérivent lentement ;
 *   - un halo radial derrière la marque ;
 *   - deux arcs en orbite qui tracent autour du « C » puis s'effacent ;
 *   - le « C » naît, grandit, puis GLISSE à sa place pendant que le clip s'ouvre
 *     et dévoile « oligo » — un seul calque, jamais deux logos superposés ;
 *   - un reflet spéculaire traverse les lettres et « allume » la marque ;
 *   - pendant l'attente réseau, la marque respire, pour ne pas paraître figée ;
 *   - sortie : la scène monte légèrement, grandit et se dissout.
 *
 * Repères mesurés sur le wordmark 800×275 (coligo_wordmark.png) :
 *   - le « C » occupe les colonnes 0→162, soit 20,3 % de la largeur ;
 *   - son centre optique est à 10,13 % en x et 43,09 % en y.
 * Le pivot est calé dessus : le C grandit sans se déplacer.
 *
 * Zéro dépendance : ni Lottie, ni AnimatedVectorDrawable. Deux vues custom qui
 * dessinent au Canvas, et des animateurs de propriété.
 */
public class IntroSplashView extends FrameLayout {

    /** Doit rester égal à @color/coligo_splash et à --seam côté CSS. */
    private static final int SEAM = 0xFF4C1B9B;

    private static final float RATIO = 800f / 275f;
    private static final float C_X = 0.1013f;
    private static final float C_Y = 0.4309f;
    private static final float C_RIGHT = 0.2005f;
    /** Décalage pour amener le centre du C au centre de l'écran. */
    private static final float SHIFT = 0.5f - C_X;

    private static final float ZOOM = 1.62f;
    /** La marque démarre voilée : on ne peut pas éclaircir du blanc pur. */
    private static final float VEIL = 0.86f;

    private static final long MARK_IN_MS = 560;
    private static final long SETTLE_DELAY_MS = 580;
    private static final long SETTLE_MS = 500;
    private static final long SHINE_DELAY_MS = 860;
    private static final long SHINE_MS = 520;
    /** Fin de la séquence d'entrée : 860 + 520. */
    public static final long ANIMATION_MS = SHINE_DELAY_MS + SHINE_MS;
    private static final long EXIT_MS = 360;

    private final FrameLayout stage;
    private final View auroraRose;
    private final View auroraViolet;
    private final View glow;
    private final GradientDrawable halo;
    private final RingView ring;
    private final WordmarkView mark;

    private AnimatorSet intro;
    private ValueAnimator breathing;
    /** Dérives infinies des nappes : hors AnimatorSet, donc à annuler à la main. */
    private final java.util.List<Animator> loops = new java.util.ArrayList<>();
    private boolean dismissed;

    public IntroSplashView(Context context) {
        super(context);
        setBackgroundColor(SEAM);
        // Avale les touches : pendant l'intro, rien derrière ne doit réagir.
        setClickable(true);
        setFocusable(true);

        auroraRose = blob(context, 0x8CFF2D7A);
        addView(auroraRose, new LayoutParams(0, 0));
        auroraViolet = blob(context, 0x998A4DFF);
        addView(auroraViolet, new LayoutParams(0, 0));

        stage = new FrameLayout(context);
        addView(stage, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));

        glow = new View(context);
        // Violet SATURÉ, jamais de blanc : du blanc sur ce fond éclaircit mais
        // désature, et le halo salit l'image au lieu de l'éclairer.
        halo = radial(new int[] { 0x4DC48CFF, 0x42A86DFF, 0x29FF2D7A, 0x00000000 });
        glow.setBackground(halo);
        glow.setAlpha(0f);
        stage.addView(glow, new LayoutParams(0, 0, Gravity.CENTER));

        ring = new RingView(context);
        ring.setAlpha(0f);
        stage.addView(ring, new LayoutParams(0, 0, Gravity.CENTER));

        mark = new WordmarkView(context);
        mark.setAlpha(0f);
        stage.addView(mark, new LayoutParams(0, 0, Gravity.CENTER));
    }

    private static GradientDrawable radial(int[] colors) {
        GradientDrawable d = new GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM, colors);
        d.setGradientType(GradientDrawable.RADIAL_GRADIENT);
        d.setShape(GradientDrawable.OVAL);
        // Un RADIAL_GRADIENT sans rayon ne dessine RIEN. Le vrai rayon est posé
        // dans onSizeChanged, quand la taille est connue.
        d.setGradientRadius(1f);
        return d;
    }

    /**
     * Nappe de couleur : cœur opaque → traîne → transparent.
     *
     * L'arrêt intermédiaire garde la TEINTE du cœur et ne change que l'alpha.
     * Un `core & 0x33FFFFFF` donnerait une alpha nulle (0x8C & 0x33 == 0) et la
     * nappe disparaîtrait à mi-course.
     */
    private static View blob(Context c, int core) {
        int mid = (core & 0x00FFFFFF) | 0x3B000000;
        int edge = core & 0x00FFFFFF;
        View v = new View(c);
        GradientDrawable d = radial(new int[] { core, mid, edge });
        v.setBackground(d);
        v.setAlpha(0f);
        v.setTag(d);
        return v;
    }

    @Override
    protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        super.onSizeChanged(w, h, oldw, oldh);
        if (w == 0 || h == 0) return;

        float density = getResources().getDisplayMetrics().density;

        // --- Nappes : très larges, débordent volontairement de l'écran. ------
        int blobSize = Math.round(Math.max(w, h) * 1.35f);
        sizeBlob(auroraRose, blobSize, -blobSize / 3, -blobSize / 4);
        sizeBlob(auroraViolet, blobSize, w - (blobSize * 2 / 3), h - (blobSize * 2 / 3));

        // --- Marque ---------------------------------------------------------
        int markW = Math.round(Math.min(w * 0.66f, 296f * density));
        int markH = Math.round(markW / RATIO);
        LayoutParams mp = (LayoutParams) mark.getLayoutParams();
        mp.width = markW;
        mp.height = markH;
        mark.setLayoutParams(mp);
        mark.setPivotX(markW * C_X);
        mark.setPivotY(markH * C_Y);

        // --- Halo et arcs : centrés sur le centre OPTIQUE du C, pas sur la
        //     boîte. On décale par translation ; les marges d'un FrameLayout
        //     centré ne se comportent pas comme un simple offset. -------------
        float dy = markH * (C_Y - 0.5f);

        int glowSize = Math.round(Math.min(w * 0.80f, 320f * density));
        LayoutParams gp = (LayoutParams) glow.getLayoutParams();
        gp.width = glowSize;
        gp.height = glowSize;
        glow.setLayoutParams(gp);
        halo.setGradientRadius(glowSize / 2f);
        glow.setTranslationY(dy);

        int ringSize = Math.round(Math.min(w * 0.58f, 224f * density));
        LayoutParams rp = (LayoutParams) ring.getLayoutParams();
        rp.width = ringSize;
        rp.height = ringSize;
        ring.setLayoutParams(rp);
        ring.setTranslationY(dy);
        ring.setStrokeWidths(2.4f * density, 1.3f * density);

        resetToStart(markW, markH);
    }

    private void sizeBlob(View v, int size, int x, int y) {
        LayoutParams lp = (LayoutParams) v.getLayoutParams();
        lp.width = size;
        lp.height = size;
        v.setLayoutParams(lp);
        v.setX(x);
        v.setY(y);
        ((GradientDrawable) v.getTag()).setGradientRadius(size / 2f);
    }

    /** État de départ : cadré sur le C, agrandi, centré écran, invisible. */
    private void resetToStart(int markW, int markH) {
        mark.setAlpha(0f);
        mark.setScaleX(ZOOM * 0.88f);
        mark.setScaleY(ZOOM * 0.88f);
        mark.setTranslationX(markW * SHIFT);
        mark.setClipBounds(new Rect(0, 0, Math.round(markW * C_RIGHT), markH));
        mark.setVeil(VEIL);
        mark.setShine(-1f);
    }

    /** Lance la séquence. `onDone` est appelé à la fin, sur le thread UI. */
    public void play(final Runnable onDone) {
        if (getWidth() == 0) {
            post(new Runnable() {
                @Override
                public void run() {
                    play(onDone);
                }
            });
            return;
        }
        if (intro != null) return;

        final int markW = mark.getLayoutParams().width;
        final int markH = mark.getLayoutParams().height;

        PathInterpolator spring = new PathInterpolator(0.16f, 1f, 0.3f, 1f);
        PathInterpolator expressive = new PathInterpolator(0.65f, 0f, 0.1f, 1f);
        PathInterpolator soft = new PathInterpolator(0.22f, 1f, 0.36f, 1f);

        // Nappes : apparition douce, puis dérive lente et infinie.
        ObjectAnimator roseIn = ObjectAnimator.ofFloat(auroraRose, View.ALPHA, 0f, 1f);
        roseIn.setDuration(700);
        ObjectAnimator violetIn = ObjectAnimator.ofFloat(auroraViolet, View.ALPHA, 0f, 1f);
        violetIn.setDuration(900);
        drift(auroraRose, 22f, 16f, 5400);
        drift(auroraViolet, -18f, -22f, 6200);

        // Halo : gonfle puis s'éteint quand la marque part vers la gauche.
        ObjectAnimator haloIn = ObjectAnimator.ofFloat(glow, View.ALPHA, 0f, 1f);
        haloIn.setDuration(420);
        haloIn.setInterpolator(soft);
        ObjectAnimator haloScale = ObjectAnimator.ofFloat(glow, View.SCALE_X, 0.6f, 1f);
        haloScale.setDuration(460);
        haloScale.setInterpolator(soft);
        ObjectAnimator haloScaleY = ObjectAnimator.ofFloat(glow, View.SCALE_Y, 0.6f, 1f);
        haloScaleY.setDuration(460);
        haloScaleY.setInterpolator(soft);
        ObjectAnimator haloOut = ObjectAnimator.ofFloat(glow, View.ALPHA, 1f, 0f);
        haloOut.setStartDelay(600);
        haloOut.setDuration(360);

        // Arcs en orbite : ils tracent, puis s'écartent en s'effaçant.
        ValueAnimator arcs = ValueAnimator.ofFloat(0f, 1f);
        arcs.setStartDelay(40);
        arcs.setDuration(760);
        arcs.setInterpolator(soft);
        arcs.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
            @Override
            public void onAnimationUpdate(ValueAnimator a) {
                ring.setProgress((float) a.getAnimatedValue());
            }
        });
        ObjectAnimator ringIn = ObjectAnimator.ofFloat(ring, View.ALPHA, 0f, 1f);
        ringIn.setStartDelay(40);
        ringIn.setDuration(220);
        ObjectAnimator ringOut = ObjectAnimator.ofFloat(ring, View.ALPHA, 1f, 0f);
        ringOut.setStartDelay(600);
        ringOut.setDuration(280);
        ObjectAnimator ringGrow = ObjectAnimator.ofFloat(ring, View.SCALE_X, 0.84f, 1.14f);
        ringGrow.setDuration(880);
        ringGrow.setInterpolator(soft);
        ObjectAnimator ringGrowY = ObjectAnimator.ofFloat(ring, View.SCALE_Y, 0.84f, 1.14f);
        ringGrowY.setDuration(880);
        ringGrowY.setInterpolator(soft);

        // Le C naît.
        ObjectAnimator markIn = ObjectAnimator.ofFloat(mark, View.ALPHA, 0f, 1f);
        markIn.setDuration(MARK_IN_MS);
        markIn.setInterpolator(spring);
        ValueAnimator grow = ValueAnimator.ofFloat(ZOOM * 0.88f, ZOOM);
        grow.setDuration(MARK_IN_MS);
        grow.setInterpolator(spring);
        grow.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
            @Override
            public void onAnimationUpdate(ValueAnimator a) {
                float s = (float) a.getAnimatedValue();
                mark.setScaleX(s);
                mark.setScaleY(s);
            }
        });

        // Le mouvement signature. Un SEUL animateur pilote échelle, translation
        // et clip : ils ne peuvent donc jamais se désynchroniser.
        ValueAnimator settle = ValueAnimator.ofFloat(0f, 1f);
        settle.setStartDelay(SETTLE_DELAY_MS);
        settle.setDuration(SETTLE_MS);
        settle.setInterpolator(expressive);
        settle.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
            @Override
            public void onAnimationUpdate(ValueAnimator a) {
                float t = (float) a.getAnimatedValue();
                float scale = ZOOM + (1f - ZOOM) * t;
                mark.setScaleX(scale);
                mark.setScaleY(scale);
                mark.setTranslationX(markW * SHIFT * (1f - t));
                int right = Math.round(markW * (C_RIGHT + (1f - C_RIGHT) * t));
                mark.setClipBounds(new Rect(0, 0, right, markH));
            }
        });

        // Reflet spéculaire : il traverse les lettres et les porte de 86 % à
        // 100 % de blanc. C'est le seul moyen d'« allumer » une marque blanche.
        ValueAnimator shine = ValueAnimator.ofFloat(-0.35f, 1.35f);
        shine.setStartDelay(SHINE_DELAY_MS);
        shine.setDuration(SHINE_MS);
        shine.setInterpolator(new PathInterpolator(0.45f, 0f, 0.55f, 1f));
        shine.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
            @Override
            public void onAnimationUpdate(ValueAnimator a) {
                mark.setShine((float) a.getAnimatedValue());
            }
        });
        ValueAnimator unveil = ValueAnimator.ofFloat(VEIL, 1f);
        unveil.setStartDelay(SHINE_DELAY_MS + 80);
        unveil.setDuration(300);
        unveil.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
            @Override
            public void onAnimationUpdate(ValueAnimator a) {
                mark.setVeil((float) a.getAnimatedValue());
            }
        });

        intro = new AnimatorSet();
        intro.playTogether(roseIn, violetIn, haloIn, haloScale, haloScaleY, haloOut,
            arcs, ringIn, ringOut, ringGrow, ringGrowY,
            markIn, grow, settle, shine, unveil);
        intro.addListener(new AnimatorListenerAdapter() {
            @Override
            public void onAnimationEnd(Animator animation) {
                mark.setShine(-1f);
                startBreathing();
                if (onDone != null) onDone.run();
            }
        });
        intro.start();
    }

    /**
     * Dérive infinie d'une nappe. Compositeur pur, aucun redessin.
     *
     * Ces animateurs vivent HORS de l'AnimatorSet (ils ne finissent jamais) :
     * on les mémorise pour les annuler au retrait, sinon ils garderaient une
     * référence forte sur la vue détachée et continueraient de tourner.
     */
    private void drift(final View v, float dx, float dy, long period) {
        PathInterpolator ease = new PathInterpolator(0.37f, 0f, 0.63f, 1f);
        ObjectAnimator ax = ObjectAnimator.ofFloat(v, View.TRANSLATION_X, 0f, dx);
        ax.setDuration(period);
        ax.setRepeatMode(ValueAnimator.REVERSE);
        ax.setRepeatCount(ValueAnimator.INFINITE);
        ax.setInterpolator(ease);
        ObjectAnimator ay = ObjectAnimator.ofFloat(v, View.TRANSLATION_Y, 0f, dy);
        ay.setDuration(period + 700);
        ay.setRepeatMode(ValueAnimator.REVERSE);
        ay.setRepeatCount(ValueAnimator.INFINITE);
        ay.setInterpolator(ease);
        loops.add(ax);
        loops.add(ay);
        ax.start();
        ay.start();
    }

    /**
     * Respiration pendant l'attente réseau. Sans elle, si la page met deux
     * secondes à peindre, l'écran paraît gelé — et un écran gelé, c'est un
     * écran planté, pour l'utilisateur.
     */
    private void startBreathing() {
        if (dismissed || breathing != null) return;
        breathing = ValueAnimator.ofFloat(1f, 1.012f);
        breathing.setDuration(1500);
        breathing.setRepeatMode(ValueAnimator.REVERSE);
        breathing.setRepeatCount(ValueAnimator.INFINITE);
        breathing.setInterpolator(new PathInterpolator(0.37f, 0f, 0.63f, 1f));
        breathing.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
            @Override
            public void onAnimationUpdate(ValueAnimator a) {
                float s = (float) a.getAnimatedValue();
                mark.setScaleX(s);
                mark.setScaleY(s);
            }
        });
        breathing.start();
    }

    /** Sortie : la scène décolle et se dissout. Idempotent. */
    public void dismiss(final Runnable onRemoved) {
        if (dismissed) return;
        dismissed = true;
        stopAll();

        float density = getResources().getDisplayMetrics().density;
        stage.animate()
            .scaleX(1.06f).scaleY(1.06f)
            .translationY(-10f * density)
            .setDuration(EXIT_MS)
            .setInterpolator(new PathInterpolator(0.32f, 0f, 0.67f, 0f))
            .start();

        animate()
            .alpha(0f)
            .setDuration(EXIT_MS)
            .setInterpolator(new LinearInterpolator())
            .withEndAction(new Runnable() {
                @Override
                public void run() {
                    detach();
                    if (onRemoved != null) onRemoved.run();
                }
            })
            .start();
    }

    /** Retrait IMMÉDIAT, sans fondu. */
    public void remove() {
        if (dismissed) return;
        dismissed = true;
        stopAll();
        detach();
    }

    private void stopAll() {
        if (intro != null) intro.cancel();
        if (breathing != null) breathing.cancel();
        for (Animator a : loops) a.cancel();
        loops.clear();
        stage.animate().cancel();
        animate().cancel();
    }

    private void detach() {
        if (getParent() instanceof android.view.ViewGroup) {
            ((android.view.ViewGroup) getParent()).removeView(this);
        }
        mark.release();
    }

    public boolean isDismissed() {
        return dismissed;
    }

    // =========================================================================

    /**
     * Le wordmark, avec son reflet.
     *
     * Le reflet est une bande blanche translatée, composée en SRC_ATOP par-dessus
     * le bitmap DANS UNE COUCHE À PART : elle ne peint donc que là où la marque
     * a de la matière. C'est l'équivalent natif du `mask-image` + `screen` du CSS,
     * sans le moindre asset supplémentaire.
     */
    private static final class WordmarkView extends View {
        private final Bitmap bmp;
        private final Paint base = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG);
        private final Paint shinePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Rect dst = new Rect();
        /** Position de la bande, en fraction de largeur. < -0.3 = pas de reflet. */
        private float shine = -1f;

        WordmarkView(Context c) {
            super(c);
            bmp = BitmapFactory.decodeResource(c.getResources(), R.drawable.coligo_wordmark);
            base.setAlpha(Math.round(VEIL * 255));
            shinePaint.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.SRC_ATOP));
        }

        void setVeil(float v) {
            base.setAlpha(Math.round(Math.max(0f, Math.min(1f, v)) * 255));
            invalidate();
        }

        void setShine(float s) {
            shine = s;
            invalidate();
        }

        void release() {
            if (bmp != null && !bmp.isRecycled()) bmp.recycle();
        }

        @Override
        protected void onDraw(Canvas canvas) {
            if (bmp == null || bmp.isRecycled()) return;
            dst.set(0, 0, getWidth(), getHeight());

            boolean withShine = shine > -0.4f && shine < 1.4f;
            int layer = withShine
                ? canvas.saveLayer(0, 0, getWidth(), getHeight(), null)
                : -1;

            canvas.drawBitmap(bmp, null, dst, base);

            if (withShine) {
                float w = getWidth();
                float band = w * 0.22f;
                float cx = shine * w;
                shinePaint.setShader(new LinearGradient(
                    cx - band, 0, cx + band, 0,
                    new int[] { 0x00FFFFFF, 0xFFFFFFFF, 0x00FFFFFF },
                    new float[] { 0f, 0.5f, 1f },
                    Shader.TileMode.CLAMP));
                canvas.drawRect(dst, shinePaint);
                canvas.restoreToCount(layer);
            }
        }
    }

    /**
     * Deux arcs en orbite. `progress` de 0 à 1 : ils tracent en tournant,
     * l'extérieur dans un sens, l'intérieur dans l'autre.
     */
    private static final class RingView extends View {
        private final Paint outer = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint inner = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF ovalOuter = new RectF();
        private final RectF ovalInner = new RectF();
        private float progress;

        RingView(Context c) {
            super(c);
            outer.setStyle(Paint.Style.STROKE);
            outer.setStrokeCap(Paint.Cap.ROUND);
            inner.setStyle(Paint.Style.STROKE);
            inner.setStrokeCap(Paint.Cap.ROUND);
            inner.setColor(0xD9C4A5FF);
        }

        void setStrokeWidths(float o, float i) {
            outer.setStrokeWidth(o);
            inner.setStrokeWidth(i);
        }

        void setProgress(float p) {
            progress = p;
            invalidate();
        }

        @Override
        protected void onSizeChanged(int w, int h, int ow, int oh) {
            super.onSizeChanged(w, h, ow, oh);
            float pad = outer.getStrokeWidth();
            ovalOuter.set(pad, pad, w - pad, h - pad);
            float in = w * 0.09f;
            ovalInner.set(in, in, w - in, h - in);
            // Rose → blanc, comme le dégradé du web.
            outer.setShader(new LinearGradient(0, 0, w, h,
                new int[] { 0x00FF2D7A, 0xF2FF2D7A, 0xE6FFFFFF },
                new float[] { 0f, 0.55f, 1f },
                Shader.TileMode.CLAMP));
        }

        @Override
        protected void onDraw(Canvas canvas) {
            if (progress <= 0f) return;
            // L'arc extérieur balaie 300° en tournant : il « trace » l'orbite.
            canvas.drawArc(ovalOuter, -90f + 360f * progress, -300f * progress, false, outer);
            // L'intérieur repart dans l'autre sens, plus court.
            canvas.drawArc(ovalInner, 90f - 300f * progress, 120f * progress, false, inner);
        }
    }
}
