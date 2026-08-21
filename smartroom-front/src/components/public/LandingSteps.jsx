import { Reveal } from './Reveal';

const STEPS = [
  {
    number: '01',
    title: 'Décrivez le besoin',
    body: 'Date, créneau, effectif, équipements requis, bâtiment de préférence.',
  },
  {
    number: '02',
    title: 'Comparez les salles proposées',
    body: 'Chaque salle affiche son score, sa justification et son taux d’occupation.',
  },
  {
    number: '03',
    title: 'Validez le créneau',
    body: 'Le calendrier signale les conflits et propose des alternatives immédiates.',
  },
  {
    number: '04',
    title: 'Recevez votre code d’accès',
    body: 'Confirmation par e-mail, rappel avant la réunion, validation de présence sur place.',
  },
];

/** P-01 — ancre #fonctionnement : le tunnel de réservation en quatre étapes. */
export function LandingSteps() {
  return (
    <section id="fonctionnement" className="scroll-mt-16">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:py-20">
        <Reveal as="h2" className="text-2xl font-semibold tracking-tight text-content sm:text-3xl">
          Comment ça marche
        </Reveal>

        <ol className="mt-8 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <Reveal as="li" key={step.number} delay={index * 90}>
              <span className="group block h-full rounded-xl border border-line bg-surface p-5 transition duration-300 hover:-translate-y-1 hover:border-line-strong">
                <span className="inline-block font-mono text-xs text-accent transition-transform duration-300 group-hover:scale-125">
                  {step.number}
                </span>
                <span className="mt-3 block text-sm font-semibold text-content">{step.title}</span>
                <span className="mt-2 block text-xs leading-relaxed text-content-muted">{step.body}</span>
              </span>
            </Reveal>
          ))}
        </ol>

      </div>
    </section>
  );
}
