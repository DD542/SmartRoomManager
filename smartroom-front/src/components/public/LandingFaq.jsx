import { ChevronDown } from 'lucide-react';

const QUESTIONS = [
  {
    q: 'Comment le système détecte-t-il un conflit ?',
    a: 'Toute demande est comparée aux réservations actives de la même salle. Le moteur distingue le chevauchement total, le chevauchement partiel et le créneau simplement trop proche du précédent, quand le battement exigé par la salle n’est pas respecté.',
  },
  {
    q: 'Sur quels critères une salle est-elle recommandée ?',
    a: 'Un score sur 100 pondère l’ajustement de la capacité (un surdimensionnement est pénalisé), la présence des équipements demandés, votre bâtiment de préférence et le taux d’occupation de la salle. La justification affichée découle directement de ce calcul.',
  },
  {
    q: 'Puis-je réserver en dehors des jours d’ouverture d’une salle ?',
    a: 'Chaque salle possède ses jours de visite autorisés. Pour un créneau en dehors, une demande d’accès exceptionnel est adressée au gestionnaire du site, qui la valide ou la refuse.',
  },
  {
    q: 'Que se passe-t-il si je ne me présente pas ?',
    a: 'La présence se valide sur place avec le code affiché à l’entrée de la salle. Sans validation dans la fenêtre prévue, le créneau est libéré et redevient réservable.',
  },
];

/** P-01 — ancre #faq. Accordéon natif <details>, accessible sans JavaScript. */
export function LandingFaq() {
  return (
    <section id="faq" className="scroll-mt-16">
      <div className="mx-auto w-full max-w-3xl px-4 py-14">
        <h2 className="text-2xl font-semibold tracking-tight text-content">Questions fréquentes</h2>

        <div className="mt-6 flex flex-col gap-2">
          {QUESTIONS.map((item) => (
            <details
              key={item.q}
              className="group rounded-xl border border-line bg-surface px-4 py-3 transition open:border-line-strong"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-content">
                {item.q}
                <ChevronDown
                  size={16}
                  aria-hidden="true"
                  className="shrink-0 text-content-muted transition group-open:rotate-180"
                />
              </summary>
              <p className="mt-3 text-xs leading-relaxed text-content-muted">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
