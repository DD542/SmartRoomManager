import { useEffect } from 'react';
import { LandingHero } from '../../components/public/LandingHero';
import { LandingProblems } from '../../components/public/LandingProblems';
import { LandingFeatures } from '../../components/public/LandingFeatures';
import { LandingSteps } from '../../components/public/LandingSteps';
import { LandingFaq } from '../../components/public/LandingFaq';
import { LandingCta } from '../../components/public/LandingCta';

/**
 * P-01 — Landing page publique.
 * Assemble les cinq sections ; chacune reste autonome et testable isolément.
 */
export default function LandingPage() {
  useEffect(() => {
    document.title = 'SmartRoom Manager — Réservation intelligente des salles';
  }, []);

  return (
    <>
      <LandingHero />
      <LandingProblems />
      <LandingFeatures />
      <LandingSteps />
      <LandingFaq />
      <LandingCta />
    </>
  );
}
