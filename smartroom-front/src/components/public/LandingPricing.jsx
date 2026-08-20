import { Check } from 'lucide-react';
import { cn } from '../../utils/cn';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

const PLANS = [
  {
    id: 'campus',
    name: 'Campus',
    price: 'Inclus',
    unit: 'dans la licence établissement',
    description: 'Pour un site unique, déjà équipé de son parc de salles.',
    features: [
      'Jusqu’à 25 salles connectées',
      'Réservation, modification, annulation',
      'Détection de conflits et recommandation',
      'E-mails de confirmation et de rappel',
    ],
  },
  {
    id: 'multisite',
    name: 'Multi-sites',
    price: '2 €',
    unit: 'par salle et par mois',
    description: 'Pour plusieurs bâtiments avec des règles d’accès distinctes.',
    featured: true,
    features: [
      'Salles et bâtiments illimités',
      'Jours de visite et accès dérogatoires',
      'Plans de localisation déposés par l’administration',
      'Statistiques d’occupation par site',
    ],
  },
  {
    id: 'surmesure',
    name: 'Sur mesure',
    price: 'Sur devis',
    unit: 'accompagnement inclus',
    description: 'Pour une intégration à votre annuaire et à vos terminaux de salle.',
    features: [
      'Authentification par l’annuaire de l’école',
      'Badges et terminaux de porte',
      'Export des données et API dédiée',
      'Support prioritaire',
    ],
  },
];

/** P-01 — ancre #tarifs. Grille indicative pour un déploiement d'établissement. */
export function LandingPricing() {
  return (
    <section id="tarifs" className="scroll-mt-16 border-b border-line">
      <div className="mx-auto w-full max-w-6xl px-4 py-14">
        <h2 className="text-2xl font-semibold tracking-tight text-content">Tarifs</h2>
        <p className="mt-2 max-w-xl text-sm text-content-muted">
          Grille indicative pour un déploiement d’établissement. Le périmètre se définit au nombre de
          salles réellement connectées.
        </p>

        <div className="mt-8 grid gap-3 md:grid-cols-3">
          {PLANS.map((plan) => (
            <Card
              key={plan.id}
              tone={plan.featured ? 'accent' : undefined}
              className={cn('flex h-full flex-col p-5', plan.featured && 'bg-accent-soft')}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-content">{plan.name}</h3>
                {plan.featured && (
                  <span className="rounded-full border border-accent/40 bg-surface px-2 py-0.5 text-[10px] uppercase tracking-wide text-accent">
                    Le plus courant
                  </span>
                )}
              </div>

              <p className="mt-3">
                <span className="font-mono text-2xl text-content">{plan.price}</span>
                <span className="ml-2 text-xs text-content-muted">{plan.unit}</span>
              </p>
              <p className="mt-2 text-xs leading-relaxed text-content-muted">{plan.description}</p>

              <ul className="mt-4 flex flex-1 flex-col gap-2">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2 text-xs text-content-muted">
                    <Check size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-success" />
                    {feature}
                  </li>
                ))}
              </ul>

              <Button
                to="/connexion"
                variant={plan.featured ? 'primary' : 'secondary'}
                size="sm"
                fullWidth
                className="mt-5"
              >
                {plan.id === 'surmesure' ? 'Nous contacter' : 'Commencer'}
              </Button>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
