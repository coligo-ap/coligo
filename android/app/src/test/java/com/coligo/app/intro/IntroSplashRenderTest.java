package com.coligo.app.intro;

import android.app.Application;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.view.View;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import org.robolectric.shadows.ShadowSystemClock;

import java.io.File;
import java.io.FileOutputStream;
import java.time.Duration;

/**
 * PHOTOGRAPHIE l'écran de lancement, frame par frame, hors appareil.
 *
 * Il ne teste pas une assertion : il produit des PNG qu'on REGARDE. C'est
 * volontaire. Deux versions de cette intro ont été livrées sur Google Play sans
 * avoir jamais été rendues nulle part — l'une d'elles n'affichait rien du tout
 * sur un vrai téléphone, sans la moindre exception dans logcat. Une animation
 * ne se relit pas, elle se voit.
 *
 * Deux choses rendent ça possible :
 *   - {@code GraphicsMode.NATIVE} — Robolectric exécute le VRAI Skia d'Android.
 *     Les VectorDrawable sont réellement rastérisés, le {@code saveLayer} et le
 *     {@code SRC_ATOP} du reflet composent pour de bon. En mode LEGACY, tous les
 *     appels Canvas sont des no-ops et on obtiendrait une image vide.
 *   - {@code ShadowSystemClock} — l'intro lit {@code SystemClock.uptimeMillis()}
 *     plutôt qu'un ValueAnimator (pour survivre à « échelle d'animation = 0 »).
 *     Cette horloge-là est pilotable : on saute exactement sur la frame voulue,
 *     le rendu est déterministe et ne dépend pas de la vitesse de la machine.
 *
 * Lancer :
 *   ./gradlew :app:testClientDebugUnitTest --tests '*IntroSplashRenderTest*'
 * Les images sortent dans android/app/build/intro-frames/.
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34, qualifiers = "w411dp-h891dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class IntroSplashRenderTest {

    /** Un écran de téléphone courant, en pixels réels. */
    private static final int W = 1080, H = 2340;

    /**
     * Les instants qui décident. Chaque valeur correspond à une intention du
     * scénario — si l'un de ces PNG ment, le scénario ment.
     */
    private static final long[] FRAMES = {
        0,    // fond blanc nu, rien d'autre
        180,  // le « C » seul, centré
        360,  // la route sort par la gauche
        560,  // « oligo » se dévoile, la ville se lève
        720,  // la boutique est là, le colis vient d'être emballé
        1050, // la voiture est à quai
        1140, // le colis est en l'air
        1250, // le feu est vert, elle démarre
        1500, // pleine ligne droite
        1720, // elle est DANS le virage — le cap doit avoir pivoté
        1900, // elle descend vers le client
        1990, // elle se gare devant la porte
        2220, // fin de l'entrée : le repère est tombé
        2600, // au-delà : les trois points, si la page tarde
    };

    @Test
    public void photographieLIntro() throws Exception {
        Application app = RuntimeEnvironment.getApplication();

        IntroSplashView view = new IntroSplashView(app);
        view.measure(
            View.MeasureSpec.makeMeasureSpec(W, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(H, View.MeasureSpec.EXACTLY));
        view.layout(0, 0, W, H);

        // On VIDE le dossier. Sans ça, changer la chronologie laisse les frames
        // de l'ancienne derrière : on relit une planche qui mélange deux
        // versions du dessin sans qu'aucune ne le dise.
        File out = new File("build/intro-frames");
        out.mkdirs();
        File[] stale = out.listFiles();
        if (stale != null) for (File f : stale) f.delete();

        view.play(null);
        final long t0 = android.os.SystemClock.uptimeMillis();

        for (long t : FRAMES) {
            long delta = (t0 + t) - android.os.SystemClock.uptimeMillis();
            if (delta > 0) ShadowSystemClock.advanceBy(Duration.ofMillis(delta));

            Bitmap full = Bitmap.createBitmap(W, H, Bitmap.Config.ARGB_8888);
            view.draw(new Canvas(full));

            // Réduite au tiers : on juge une composition et un rythme, pas un
            // pixel. Et une planche de 13 images pleine résolution est illisible.
            Bitmap small = Bitmap.createScaledBitmap(full, W / 3, H / 3, true);
            write(new File(out, String.format("t%04d.png", t)), small);

            // Sauf pour la voiture. Réduite au tiers elle fait 26 px de large :
            // on ne voit ni le toit de verre, ni les roues qui braquent, ni de
            // quel côté du marquage elle roule. On garde donc, aux instants qui
            // comptent, une bande de chaussée à l'échelle 1.
            if (t == 1500) crop(out, "zoom-ligne-droite.png", full, 0, 1390, 1080, 300);
            if (t == 1720) crop(out, "zoom-virage.png", full, 560, 1420, 520, 640);
            if (t == 2220) crop(out, "zoom-arrivee.png", full, 380, 1660, 700, 560);

            full.recycle();
            small.recycle();
        }
    }

    private static void crop(File dir, String name, Bitmap src, int x, int y, int w, int h)
        throws Exception {
        int cw = Math.min(w, src.getWidth() - x);
        int ch = Math.min(h, src.getHeight() - y);
        Bitmap c = Bitmap.createBitmap(src, x, y, cw, ch);
        write(new File(dir, name), c);
        c.recycle();
    }

    private static void write(File f, Bitmap b) throws Exception {
        try (FileOutputStream fos = new FileOutputStream(f)) {
            b.compress(Bitmap.CompressFormat.PNG, 100, fos);
        }
    }
}
