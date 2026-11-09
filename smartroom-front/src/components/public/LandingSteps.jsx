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
    <section id="fonctionnement" className="scroll-mt-24">
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:py-28">
        <Reveal as="h2" className="font-display text-3xl font-normal tracking-[-0.02em] text-content sm:text-5xl">
          Comment ça <span className="font-extrabold italic">marche</span>
        </Reveal>

        <ol className="mt-8 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <Reveal as="li" key={step.number} delay={index * 90}>
              <span className="group block h-full rounded-[28px] border border-line/70 bg-surface/80 p-6 shadow-carte transition duration-500 ease-ressort hover:-translate-y-1.5 hover:shadow-haute">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-corail/15 font-display text-lg font-extrabold italic text-[#E8613A] transition-all duration-500 ease-ressort group-hover:scale-110 group-hover:bg-corail group-hover:text-[#0C1547]">
                  {step.number}
                </span>
                <span className="mt-4 block text-base font-semibold tracking-tight text-content">{step.title}</span>
                <span className="mt-2 block text-sm leading-relaxed text-content-muted">{step.body}</span>
              </span>
            </Reveal>
          ))}
        </ol>

      </div>
    </section>
  );
}
