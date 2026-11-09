import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Bell,
  BarChart3,
  CalendarCheck,
  CheckCircle2,
  CircleCheck,
  Clock,
  DoorOpen,
  House,
  KeyRound,
  Map,
  Monitor,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  Wifi,
} from 'lucide-react';
import { LogoMark } from '../brand/Logo';

/**
 * Taille de conception de l'aperçu. Tout est dessiné à cette taille, puis
 * réduit d'un bloc pour tenir dans la colonne : les proportions, les tailles
 * de texte et les arrondis restent ceux d'un vrai écran, quelle que soit la
 * largeur de la page.
 */
const LARGEUR = 1120;
const HAUTEUR = 700;

const SALLES = [
  { nom: 'Amphi Horizon', lieu: 'Bât. A · RDC', places: 90, photo: '/apercu/amphi.webp', libre: true, taux: 0.72 },
  { nom: 'Atelier Monge', lieu: 'Bât. E · Sous-sol', places: 20, photo: '/apercu/atelier.webp', libre: true, taux: 0.45 },
  { nom: 'Salle Conseil Alpha', lieu: 'Bât. C · 3e étage', places: 12, photo: '/apercu/conseil.webp', libre: false, taux: 0.88 },
];

const NAVIGATION = [
  { libelle: 'Accueil', icone: House, actif: true },
  { libelle: 'Explorer les salles', icone: DoorOpen },
  { libelle: 'Mes réservations', icone: CalendarCheck },
  { libelle: 'Valider ma présence', icone: CircleCheck },
  { libelle: 'Plan du bâtiment', icone: Map },
  { libelle: 'Statistiques', icone: BarChart3 },
];

const CHIFFRES = [
  { icone: CalendarCheck, valeur: '3', libelle: 'réservations aujourd’hui', teinte: 'bg-sky-100 text-sky-600' },
  { icone: DoorOpen, valeur: '12', libelle: 'salles disponibles', teinte: 'bg-violet-100 text-violet-600' },
  { icone: BarChart3, valeur: '72 %', libelle: 'taux d’occupation', teinte: 'bg-pink-100 text-pink-600' },
  { icone: Clock, valeur: '14:00', libelle: 'prochaine réunion', teinte: 'bg-emerald-100 text-emerald-600' },
];

/** Planning du jour : une ligne par salle, un bloc coloré par réservation (heures 8 à 16). */
const PLANNING = [
  { salle: 'Horizon', blocs: [[0, 2, 'bg-sky-500'], [3, 5, 'bg-violet-500']] },
  { salle: 'Monge', blocs: [[1, 3, 'bg-pink-500'], [5, 7, 'bg-cyan-500']] },
  { salle: 'Alpha', blocs: [[0, 1, 'bg-amber-500'], [2, 6, 'bg-emerald-500']] },
  { salle: 'Vinci', blocs: [[4, 7, 'bg-violet-500']] },
];

/** Réduit l'écran dessiné à la largeur disponible. */
function useEchelle() {
  const cadre = useRef(null);
  const [echelle, setEchelle] = useState(0.6);

  useEffect(() => {
    const element = cadre.current;
    if (!element) return undefined;
    const mesurer = () => setEchelle(element.clientWidth / LARGEUR || 0.6);
    mesurer();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(element);
    return () => observateur.disconnect();
  }, []);

  return [cadre, echelle];
}

function CarteSalle({ salle, rang }) {
  return (
    <div
      className="animate-fade-in-up overflow-hidden rounded-[20px] border border-white/60 bg-white/80 p-2 shadow-[0_12px_30px_-18px_rgb(30_30_60/0.35)]"
      style={{ animationDelay: `${600 + rang * 120}ms` }}
    >
      <div className="relative h-[104px] overflow-hidden rounded-[14px]">
        <img src={salle.photo} alt="" className="h-full w-full object-cover" loading="lazy" />
        <span
          className={`absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold ${
            salle.libre ? 'text-emerald-700' : 'text-rose-700'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${salle.libre ? 'bg-emerald-500' : 'bg-rose-500'}`} />
          {salle.libre ? 'Disponible' : 'Occupée'}
        </span>
        <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
          <Users size={10} /> {salle.places}
        </span>
      </div>
      <div className="px-1.5 pb-1 pt-2.5">
        <p className="text-[13px] font-semibold text-slate-900">{salle.nom}</p>
        <p className="mt-0.5 text-[10px] text-slate-500">{salle.lieu}</p>
        <div className="mt-2 flex items-center gap-1.5 text-slate-500">
          {[Wifi, Monitor, ShieldCheck].map((Icone, index) => (
            <span key={index} className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100">
              <Icone size={10} />
            </span>
          ))}
        </div>
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full ${
              salle.taux > 0.8 ? 'bg-rose-500' : salle.taux > 0.6 ? 'bg-amber-500' : 'bg-emerald-500'
            }`}
            style={{ width: `${salle.taux * 100}%` }}
          />
        </div>
        <div className="mt-2.5 flex items-center justify-between">
          <span className="rounded-full bg-slate-900 px-3 py-1 text-[10px] font-medium text-white">
            Voir les créneaux
          </span>
          <ArrowRight size={12} className="text-slate-400" />
        </div>
      </div>
    </div>
  );
}

/**
 * Aperçu de l'application dans un écran, avec des cartes flottantes.
 *
 * Un vrai écran d'accueil, en miniature : barre latérale, bandeau avec la
 * façade d'un bâtiment, chiffres clés, salles avec leurs photos, planning de
 * la journée. Les photos sont celles du parc de démonstration, réduites pour
 * le web et servies par le front : la page publique ne dépend pas de l'API
 * pour s'afficher.
 *
 * Les couleurs sont fixées et non tirées du thème : c'est la capture d'un
 * écran clair, elle doit le rester sur la page sombre — comme une photo
 * d'appareil sur un site produit.
 *
 * Les éléments arrivent en cascade, puis les cartes flottantes dérivent
 * doucement. `prefers-reduced-motion` fige le tout par la règle globale
 * de `index.css`.
 */
export function AppPreview() {
  const [survol, setSurvol] = useState(false);
  const [cadre, echelle] = useEchelle();

  // Rotation et translation composées dans une seule transition : deux
  // `transform` posés par des classes différentes s'écraseraient.
  const carte = (rotationRepos, rotationSurvol, decalage) => ({
    transform: survol
      ? `rotate(${rotationSurvol}deg) translateY(${decalage}px)`
      : `rotate(${rotationRepos}deg)`,
    transition: 'transform 600ms cubic-bezier(0.34, 1.36, 0.4, 1)',
  });

  return (
    <div
      className="relative select-none"
      onMouseEnter={() => setSurvol(true)}
      onMouseLeave={() => setSurvol(false)}
    >
      <div
        ref={cadre}
        role="img"
        aria-label="Aperçu de l’application : accueil avec recherche, chiffres clés, salles disponibles avec leurs photos et planning de la journée"
        className="relative w-full overflow-hidden rounded-[22px]"
        style={{ height: HAUTEUR * echelle }}
      >
        <div
          aria-hidden="true"
          className="absolute left-0 top-0 origin-top-left"
          style={{ width: LARGEUR, height: HAUTEUR, transform: `scale(${echelle})` }}
        >
          {/* Fond d'écran : la même aurore que la page. */}
          <div className="absolute inset-0 bg-[#eef0f8]" />
          <div className="absolute -left-24 -top-24 h-80 w-[28rem] rounded-full bg-sky-300/50 blur-3xl" />
          <div className="absolute -right-16 top-10 h-72 w-96 rounded-full bg-violet-300/50 blur-3xl" />
          <div className="absolute bottom-[-6rem] left-1/3 h-72 w-96 rounded-full bg-pink-300/40 blur-3xl" />

          <div className="relative flex h-full gap-4 p-4 text-left text-slate-900">
            {/* Barre latérale */}
            <aside className="flex w-[200px] shrink-0 animate-fade-in-up flex-col rounded-[24px] border border-white/70 bg-white/70 p-4 shadow-[0_18px_40px_-24px_rgb(30_30_60/0.4)] backdrop-blur-xl">
              <div className="flex items-center gap-2 px-1">
                <LogoMark size={26} />
                <span className="text-[13px] font-semibold leading-tight">
                  SmartRoom
                  <br />
                  Manager
                </span>
              </div>
              <span className="mt-5 flex items-center justify-center gap-1.5 rounded-full bg-gradient-to-r from-sky-500 via-violet-500 to-pink-500 py-2 text-[11px] font-medium text-white shadow-[0_10px_20px_-10px_rgb(139_92_246/0.9)]">
                <Plus size={13} /> Nouvelle réservation
              </span>
              <nav className="mt-4 flex flex-col gap-1">
                {NAVIGATION.map(({ libelle, icone: Icone, actif }) => (
                  <span
                    key={libelle}
                    className={`flex items-center gap-2.5 rounded-full px-3 py-2 text-[11px] ${
                      actif
                        ? 'bg-white font-semibold shadow-[0_1px_0_white_inset,0_6px_14px_-8px_rgb(0_0_0/0.3)]'
                        : 'text-slate-500'
                    }`}
                  >
                    <Icone size={14} className={actif ? 'text-sky-600' : ''} />
                    {libelle}
                  </span>
                ))}
              </nav>
              <div className="relative mt-auto h-24 overflow-hidden rounded-[16px]">
                <img src="/apercu/batiment-c.webp" alt="" className="h-full w-full object-cover" loading="lazy" />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-900/70 to-transparent" />
                <span className="absolute bottom-2 left-2.5 text-[11px] font-semibold leading-tight text-white">
                  Bâtiment C
                  <span className="block text-[9px] font-normal opacity-80">6 salles · 3 étages</span>
                </span>
              </div>
            </aside>

            <div className="flex min-w-0 flex-1 flex-col gap-3.5">
              {/* Barre haute */}
              <div
                className="flex animate-fade-in-up items-center gap-3 rounded-full border border-white/70 bg-white/70 py-2 pl-4 pr-2 backdrop-blur-xl"
                style={{ animationDelay: '120ms' }}
              >
                <Search size={13} className="text-slate-400" />
                <span className="text-[11px] text-slate-400">Rechercher une salle, une réservation…</span>
                <span className="relative ml-auto flex h-7 w-7 items-center justify-center rounded-full bg-white">
                  <Bell size={13} />
                  <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-rose-500" />
                </span>
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-pink-400 text-[10px] font-semibold text-white">
                  CL
                </span>
              </div>

              {/* Bandeau */}
              <div
                className="relative h-[150px] shrink-0 animate-fade-in-up overflow-hidden rounded-[24px] shadow-[0_18px_40px_-24px_rgb(30_30_60/0.45)]"
                style={{ animationDelay: '200ms' }}
              >
                <img src="/apercu/batiment-a.webp" alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                <div className="absolute inset-0 bg-gradient-to-r from-[#eef0f8] via-[#eef0f8]/80 to-transparent" />
                <div className="relative flex h-full flex-col justify-between p-5">
                  <div>
                    <p className="text-[24px] font-semibold tracking-tight">
                      Bonjour,{' '}
                      <span className="bg-gradient-to-r from-sky-600 via-violet-600 to-pink-600 bg-clip-text text-transparent">
                        Camille
                      </span>{' '}
                      👋
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-600">
                      Réservez, gérez et optimisez vos espaces en toute simplicité.
                    </p>
                  </div>
                  <div className="flex w-[420px] items-center gap-2 rounded-full border border-white/80 bg-white/80 py-1 pl-4 pr-1 backdrop-blur-xl">
                    <Search size={12} className="text-slate-400" />
                    <span className="flex-1 text-[10px] text-slate-400">
                      Salle de 12 places, demain à 14 h, avec écran…
                    </span>
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-white">
                      <ArrowRight size={11} />
                    </span>
                  </div>
                </div>
              </div>

              {/* Chiffres clés */}
              <div className="grid grid-cols-4 gap-3">
                {CHIFFRES.map(({ icone: Icone, valeur, libelle, teinte }, rang) => (
                  <div
                    key={libelle}
                    className="flex animate-fade-in-up items-center gap-2.5 rounded-[18px] border border-white/70 bg-white/75 p-3 backdrop-blur-xl"
                    style={{ animationDelay: `${300 + rang * 70}ms` }}
                  >
                    <span className={`flex h-8 w-8 items-center justify-center rounded-full ${teinte}`}>
                      <Icone size={14} />
                    </span>
                    <span>
                      <span className="block text-[17px] font-semibold leading-none tracking-tight">{valeur}</span>
                      <span className="mt-1 block text-[9px] text-slate-500">{libelle}</span>
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex min-h-0 flex-1 gap-3.5">
                {/* Salles recommandées */}
                <section className="flex-1">
                  <div className="mb-2 flex items-center justify-between px-1">
                    <p className="flex items-center gap-1.5 text-[13px] font-semibold">
                      <Sparkles size={13} className="text-violet-500" /> Recommandées pour vous
                    </p>
                    <span className="text-[10px] text-slate-500">Voir tout →</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {SALLES.map((salle, rang) => (
                      <CarteSalle key={salle.nom} salle={salle} rang={rang} />
                    ))}
                  </div>
                </section>

                {/* Planning du jour */}
                <section
                  className="w-[230px] shrink-0 animate-fade-in-up rounded-[20px] border border-white/70 bg-white/75 p-3 backdrop-blur-xl"
                  style={{ animationDelay: '700ms' }}
                >
                  <p className="text-[12px] font-semibold">Aujourd’hui</p>
                  <p className="text-[9px] text-slate-500">Mardi 10 novembre</p>
                  <div className="mt-2 grid grid-cols-[42px_1fr] gap-y-2 text-[9px] text-slate-500">
                    <span />
                    <span className="flex justify-between pr-0.5">
                      <span>8h</span>
                      <span>12h</span>
                      <span>16h</span>
                    </span>
                    {PLANNING.map(({ salle, blocs }) => (
                      <div key={salle} className="contents">
                        <span className="self-center">{salle}</span>
                        <span className="relative h-5 rounded-md bg-slate-100">
                          {blocs.map(([debut, fin, couleur]) => (
                            <span
                              key={debut}
                              className={`absolute inset-y-0.5 rounded ${couleur}`}
                              style={{ left: `${(debut / 8) * 100}%`, width: `${((fin - debut) / 8) * 100}%` }}
                            />
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 rounded-[14px] bg-gradient-to-br from-sky-500 to-violet-500 p-2.5 text-white">
                    <p className="text-[9px] opacity-80">Prochaine réunion · 14:00</p>
                    <p className="mt-0.5 text-[11px] font-semibold">Revue de sprint</p>
                    <p className="text-[9px] opacity-80">Amphi Horizon · 8 participants</p>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Cartes flottantes. Le flottement est porté par l'enveloppe et
          l'inclinaison par la carte : deux `transform` sur le même nœud
          s'écraseraient, et le survol effacerait le mouvement. */}
      <div aria-hidden="true" className="absolute -right-3 top-[14%] hidden animate-flottement sm:block">
        <div style={carte(-4, -1, -10)} className="verre-epais flex items-center gap-3 rounded-2xl px-4 py-3 shadow-haute">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-aurore-emeraude/15">
            <CheckCircle2 size={18} className="text-aurore-emeraude" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-content">Salle réservée</span>
            <span className="block text-xs text-content-muted">Amphi Horizon · 14:00</span>
          </span>
        </div>
      </div>

      <div
        aria-hidden="true"
        className="absolute -left-4 bottom-[18%] hidden animate-flottement sm:block"
        style={{ animationDelay: '-3s' }}
      >
        <div style={carte(5, 2, 10)} className="verre-epais flex items-center gap-3 rounded-2xl px-4 py-3 shadow-haute">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-aurore-violet/15">
            <KeyRound size={16} className="text-aurore-violet" />
          </span>
          <span>
            <span className="block text-[10px] text-content-muted">Code d’accès</span>
            <span className="block font-mono text-base tracking-[0.15em] text-content">A-4821</span>
          </span>
        </div>
      </div>

      <div
        aria-hidden="true"
        className="absolute -bottom-5 right-[12%] hidden animate-flottement md:block"
        style={{ animationDelay: '-1.5s' }}
      >
        <div style={carte(-2, 0, -6)} className="verre-epais flex items-center gap-2.5 rounded-full py-2 pl-2 pr-4 shadow-haute">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-aurore-bleu to-aurore-violet text-white">
            <Sparkles size={13} />
          </span>
          <span className="text-xs text-content">
            <span className="font-semibold">SmartBot</span> · 3 salles libres à 14 h
          </span>
        </div>
      </div>
    </div>
  );
}
