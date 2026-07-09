package com.coligo.app.intro;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.AnimatorSet;
import android.animation.ObjectAnimator;
import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Rect;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.animation.PathInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageView;

import com.coligo.app.R;

/**
 * Intro de marque NATIVE, dessinée par-dessus la WebView.
 *
 * Pourquoi natif et pas web : l'intro web ne pouvait démarrer qu'APRÈS le
 * premier paint de la page distante (~1 à 2,5 s de réseau + SSR). Elle ajoutait
 * donc sa durée par-dessus le chargement. Ici l'animation démarre à t=0 et
 * tourne PENDANT que la WebView charge derrière : les deux se superposent au
 * lieu de s'enchaîner. L'app apparaît plus tôt, et il n'y a plus qu'un seul
 * écran, sans couture.
 *
 * Le fond est un APLAT #4C1B9B, pas un dégradé : c'est aussi la couleur du
 * `windowBackground` et de la barre de statut, donc aucun liseré au sommet de
 * l'écran. Le relief vient d'un halo radial derrière la marque.
 *
 * L'animation reprend au pixel près celle du web (components/brand/
 * intro-splash.module.css). Repères mesurés sur le wordmark 800×275 :
 *   - le « C » occupe les colonnes 0→162, soit 20,3 % de la largeur ;
 *   - son centre optique est à 10,13 % en x et 43,09 % en y.
 * On cale le pivot dessus : le C grandit sans bouger, puis glisse à sa place
 * pendant que le clip s'ouvre et dévoile « oligo ». Un seul calque.
 */
public class IntroSplashView extends FrameLayout {

    /** Doit rester égal à @color/coligo_splash et à --seam côté CSS. */
    private static final int SEAM = 0xFF4C1B9B;

    // Géométrie du wordmark (mesurée, cf. en-tête).
    private static final float RATIO = 800f / 275f;
    private static final float C_X = 0.1013f;
    private static final float C_Y = 0.4309f;
    private static final float C_RIGHT = 0.203f;
    /** Décalage pour amener le centre du C au centre de l'écran. */
    private static final float SHIFT = 0.5f - C_X;

    private static final float ZOOM = 1.62f;
    /** Le wordmark ne démarre pas blanc pur : `LIGHT_IN` l'allume à la fin. */
    private static final float VEILED = 0.86f;

    private static final long IN_MS = 560;
    private static final long SETTLE_DELAY_MS = 580;
    private static final long SETTLE_MS = 500;
    private static final long LIGHT_DELAY_MS = 940;
    private static final long LIGHT_MS = 300;
    /** Fin de l'animation : 940 + 300. */
    public static final long ANIMATION_MS = LIGHT_DELAY_MS + LIGHT_MS;
    private static final long FADE_OUT_MS = 320;

    private final ImageView mark;
    private final View glow;
    private final GradientDrawable halo;

    private AnimatorSet running;
    private boolean dismissed;

    public IntroSplashView(Context context) {
        super(context);
        setBackgroundColor(SEAM);
        // Avale les touches : pendant l'intro, rien derrière ne doit réagir.
        setClickable(true);
        setFocusable(true);

        glow = new View(context);
        // Violet SATURÉ, jamais de blanc : du blanc sur ce fond éclaircit mais
        // désature, et le halo salit l'image au lieu de l'éclairer (mesuré côté
        // web : rgb 128,90,183, un lavande gris).
        halo = new GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            new int[] { 0x4DC48CFF, 0x42A86DFF, 0x29FF2D7A, 0x00000000 }
        );
        halo.setGradientType(GradientDrawable.RADIAL_GRADIENT);
        halo.setShape(GradientDrawable.OVAL);
        // Un RADIAL_GRADIENT sans rayon ne dessine RIEN. Le rayon réel est posé
        // dans onSizeChanged, quand on connaît la taille.
        halo.setGradientRadius(1f);
        glow.setBackground(halo);
        glow.setAlpha(0f);
        addView(glow, new LayoutParams(0, 0, Gravity.CENTER));

        mark = new ImageView(context);
        mark.setImageResource(R.drawable.coligo_wordmark);
        mark.setScaleType(ImageView.ScaleType.FIT_XY);
        mark.setAlpha(0f);
        addView(mark, new LayoutParams(0, 0, Gravity.CENTER));
    }

    @Override
    protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        super.onSizeChanged(w, h, oldw, oldh);
        if (w == 0 || h == 0) return;

        float density = getResources().getDisplayMetrics().density;
        int markW = Math.round(Math.min(w * 0.66f, 296f * density));
        int markH = Math.round(markW / RATIO);

        LayoutParams mp = (LayoutParams) mark.getLayoutParams();
        mp.width = markW;
        mp.height = markH;
        mark.setLayoutParams(mp);

        int glowSize = Math.round(Math.min(w * 0.78f, 320f * density));
        LayoutParams gp = (LayoutParams) glow.getLayoutParams();
        gp.width = glowSize;
        gp.height = glowSize;
        glow.setLayoutParams(gp);
        halo.setGradientRadius(glowSize / 2f);
        // Le halo se cale sur le centre OPTIQUE du C (43,09 % de la hauteur du
        // wordmark), pas sur le centre de la boîte. On décale par translation :
        // les marges d'un FrameLayout centré ne se comportent pas comme un
        // simple offset.
        glow.setTranslationY(markH * (C_Y - 0.5f));

        // Pivot au centre optique du C : il grandit sans se déplacer.
        mark.setPivotX(markW * C_X);
        mark.setPivotY(markH * C_Y);

        applyPhaseOne(markW, markH, 0f);
    }

    /** État de départ : cadré sur le C, agrandi, centré écran, invisible. */
    private void applyPhaseOne(int markW, int markH, float alpha) {
        mark.setAlpha(alpha);
        mark.setScaleX(ZOOM);
        mark.setScaleY(ZOOM);
        mark.setTranslationX(markW * SHIFT);
        mark.setClipBounds(new Rect(0, 0, Math.round(markW * C_RIGHT), markH));
    }

    /** Lance l'animation. `onDone` est appelé à la fin, sur le thread UI. */
    public void play(final Runnable onDone) {
        if (getWidth() == 0) {
            // Pas encore mesuré : on rejoue au premier layout.
            post(new Runnable() {
                @Override
                public void run() {
                    play(onDone);
                }
            });
            return;
        }
        if (running != null) return;

        final int markW = mark.getLayoutParams().width;
        final int markH = mark.getLayoutParams().height;

        ObjectAnimator fadeIn = ObjectAnimator.ofFloat(mark, View.ALPHA, 0f, VEILED);
        fadeIn.setDuration(IN_MS);
        fadeIn.setInterpolator(new PathInterpolator(0.16f, 1f, 0.3f, 1f));

        // Entrée : le C naît un peu plus petit puis s'installe à l'échelle 1,62.
        ValueAnimator grow = ValueAnimator.ofFloat(ZOOM * 0.88f, ZOOM);
        grow.setDuration(IN_MS);
        grow.setInterpolator(new PathInterpolator(0.16f, 1f, 0.3f, 1f));
        grow.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
            @Override
            public void onAnimationUpdate(ValueAnimator a) {
                float s = (float) a.getAnimatedValue();
                mark.setScaleX(s);
                mark.setScaleY(s);
            }
        });

        ObjectAnimator haloIn = ObjectAnimator.ofFloat(glow, View.ALPHA, 0f, 1f);
        haloIn.setDuration(420);
        haloIn.setInterpolator(new PathInterpolator(0.22f, 1f, 0.36f, 1f));

        ObjectAnimator haloOut = ObjectAnimator.ofFloat(glow, View.ALPHA, 1f, 0f);
        haloOut.setStartDelay(620);
        haloOut.setDuration(340);

        // Le mouvement signature : le C glisse à sa place pendant que le clip
        // s'ouvre. Un seul ValueAnimator pilote échelle + translation + clip,
        // pour qu'ils ne puissent jamais se désynchroniser.
        ValueAnimator settle = ValueAnimator.ofFloat(0f, 1f);
        settle.setStartDelay(SETTLE_DELAY_MS);
        settle.setDuration(SETTLE_MS);
        settle.setInterpolator(new PathInterpolator(0.65f, 0f, 0.1f, 1f));
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

        // La marque « s'allume » : on ne peut pas éclaircir du blanc pur, elle
        // démarre donc voilée à 86 % et atteint 100 % ici.
        ObjectAnimator light = ObjectAnimator.ofFloat(mark, View.ALPHA, VEILED, 1f);
        light.setStartDelay(LIGHT_DELAY_MS);
        light.setDuration(LIGHT_MS);

        running = new AnimatorSet();
        running.playTogether(fadeIn, grow, haloIn, haloOut, settle, light);
        running.addListener(new AnimatorListenerAdapter() {
            @Override
            public void onAnimationEnd(Animator animation) {
                if (onDone != null) onDone.run();
            }
        });
        running.start();
    }

    /** Fond en fondu puis retrait du parent. Idempotent. */
    public void dismiss(final Runnable onRemoved) {
        if (dismissed) return;
        dismissed = true;
        if (running != null) running.cancel();

        animate()
            .alpha(0f)
            .setDuration(FADE_OUT_MS)
            .withEndAction(new Runnable() {
                @Override
                public void run() {
                    if (getParent() instanceof android.view.ViewGroup) {
                        ((android.view.ViewGroup) getParent()).removeView(IntroSplashView.this);
                    }
                    if (onRemoved != null) onRemoved.run();
                }
            })
            .start();
    }

    /** Retrait IMMÉDIAT, sans fondu (ex. page d'erreur hors-ligne à montrer). */
    public void remove() {
        if (dismissed) return;
        dismissed = true;
        if (running != null) running.cancel();
        if (getParent() instanceof android.view.ViewGroup) {
            ((android.view.ViewGroup) getParent()).removeView(this);
        }
    }

    public boolean isDismissed() {
        return dismissed;
    }

    /** Couleur de raccord, exposée pour que l'activité aligne la barre de statut. */
    public static int seamColor() {
        return Color.rgb(0x4C, 0x1B, 0x9B);
    }
}
