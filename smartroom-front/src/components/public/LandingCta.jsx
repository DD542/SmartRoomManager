import { Button } from '../ui/Button';
import { Reveal } from './Reveal';

/** P-01 — bandeau d'appel à l'action, juste avant le pied de page. */
export function LandingCta() {
  return (
    <section>
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:py-28">
        <Reveal className="verre-epais rounded-[36px] px-6 py-20 text-center shadow-haute">
          <h2 className="font-display text-3xl font-semibold tracking-[-0.03em] text-content sm:text-5xl">
            Prêt à optimiser vos espaces ?
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-base text-content-muted md:text-lg">
            Connectez-vous avec votre compte professionnel et réservez votre première salle en moins
            d’une minute.
          </p>
          <Button to="/connexion" size="lg" className="mt-6">
            Se connecter
          </Button>
        </Reveal>
      </div>
    </section>
  );
}
