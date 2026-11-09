import { ArrowRight } from 'lucide-react';
import { Button } from '../ui/Button';
import { Reveal } from './Reveal';

/**
 * P-01 — bandeau d'appel à l'action, juste avant le pied de page.
 *
 * Bloc marine, titre blanc avec un passage en gras italique, bouton corail :
 * la fin de page de MentorGoal. Deux halos corail et lavande dérivent derrière
 * le texte, et un ruban se dessine à l'entrée du bloc dans la fenêtre.
 */
export function LandingCta() {
  return (
    <section>
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:py-28">
        <Reveal className="relative overflow-hidden rounded-[36px] bg-[#263171] px-6 py-20 text-center text-white shadow-haute">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            <div className="halo-derive absolute -left-20 -top-24 h-72 w-96 rounded-full bg-[#FF8053]/35 blur-3xl" />
            <div className="halo-derive absolute -bottom-24 -right-16 h-72 w-96 rounded-full bg-[#CED5FB]/25 blur-3xl [animation-delay:-6s]" />
            <svg viewBox="0 0 800 300" fill="none" className="ruban absolute inset-x-0 bottom-0 h-56 w-full text-white/[0.07]">
              <path d="M-40 260 C 120 120, 260 300, 400 170 S 640 40, 840 120" pathLength="1" stroke="currentColor" strokeWidth="44" strokeLinecap="round" />
            </svg>
          </div>
          <h2 className="relative font-display text-3xl font-normal tracking-[-0.02em] sm:text-5xl">
            Prêt à <span className="font-extrabold italic">optimiser</span> vos espaces ?
          </h2>
          <p className="relative mx-auto mt-4 max-w-lg text-base text-white/80 md:text-lg">
            Connectez-vous avec votre compte professionnel et réservez votre première salle en moins
            d’une minute.
          </p>
          <Button to="/connexion" size="lg" variant="corail" iconRight={ArrowRight} className="relative mt-8 pl-6">
            Se connecter
          </Button>
        </Reveal>
      </div>
    </section>
  );
}
