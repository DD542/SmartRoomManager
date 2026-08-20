import { Button } from '../ui/Button';

/** P-01 — bandeau d'appel à l'action, juste avant le pied de page. */
export function LandingCta() {
  return (
    <section className="border-b border-line">
      <div className="mx-auto w-full max-w-6xl px-4 py-14">
        <div className="rounded-xl border border-line bg-surface px-6 py-12 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-content sm:text-3xl">
            Prêt à optimiser vos espaces ?
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-content-muted">
            Connectez-vous avec votre compte de l’école et réservez votre première salle en moins
            d’une minute.
          </p>
          <Button to="/connexion" size="lg" className="mt-6">
            Se connecter
          </Button>
        </div>
      </div>
    </section>
  );
}
