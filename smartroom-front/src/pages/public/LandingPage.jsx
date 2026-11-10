import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { LandingHero } from '../../components/public/LandingHero';
import { LandingProblems } from '../../components/public/LandingProblems';
import { LandingDemo } from '../../components/public/LandingDemo';
import { LandingFeatures } from '../../components/public/LandingFeatures';
import { LandingSteps } from '../../components/public/LandingSteps';
import { LandingFaq } from '../../components/public/LandingFaq';
import { LandingCta } from '../../components/public/LandingCta';

/**
 * P-01 — Landing page publique.
 * Assemble les sections ; chacune reste autonome et testable isolément.
 *
 * La démonstration vient après les problèmes et avant les fonctionnalités :
 * le visiteur vient de lire ce qui ne va pas, la vidéo montre le produit en
 * marche, le reste détaille. Une démonstration reléguée en fin de page n'est
 * vue que par ceux qui étaient déjà convaincus.
 */
export default function LandingPage() {
  const { hash } = useLocation();

  useEffect(() => {
    document.title = 'SmartRoom Manager — Réservation intelligente des salles';
  }, []);

  // Arrivée depuis une autre page publique avec une ancre (« FAQ » cliqué
  // depuis les mentions légales) : le routeur ne fait pas défiler seul vers
  // une section rendue après lui.
  useEffect(() => {
    if (!hash) return;
    const cible = document.getElementById(decodeURIComponent(hash.slice(1)));
    cible?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hash]);

  return (
    <>
      <LandingHero />
      <LandingProblems />
      <LandingDemo />
      <LandingFeatures />
      <LandingSteps />
      <LandingFaq />
      <LandingCta />
    </>
  );
}
