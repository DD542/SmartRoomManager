
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
    <section id="fonctionnement" className="scroll-mt-16 border-b border-line">
      <div className="mx-auto w-full max-w-6xl px-4 py-14">
        <h2 className="text-2xl font-semibold tracking-tight text-content">Comment ça marche</h2>

        <ol className="mt-8 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step) => (
            <li key={step.number} className="rounded-xl border border-line bg-surface p-5">
              <span className="font-mono text-xs text-accent">{step.number}</span>
              <h3 className="mt-3 text-sm font-semibold text-content">{step.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-content-muted">{step.body}</p>
            </li>
          ))}
        </ol>

      </div>
    </section>
  );
}
