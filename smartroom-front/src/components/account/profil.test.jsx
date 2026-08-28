/**
 * Menu de compte, avatar et dépôt de photo.
 *
 * Trois pièces qui portent chacune un risque différent : l'avatar doit rester
 * lisible quand l'image manque, le menu doit s'utiliser au clavier, et le
 * champ de fichier doit se laisser réessayer après un refus. Aucune des trois
 * ne se voit dans un diff.
 */

import { describe, expect, it, vi } from 'vitest';
import { HttpResponse, http } from 'msw';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Avatar } from '../ui/Avatar';
import { AvatarField } from './AvatarField';
import { AccountMenu } from '../admin/AccountMenu';
import { SessionList } from '../admin/account/SessionList';
import { AdminSessionContext } from '../../hooks/useAdminSession';
import { ToastProvider } from '../../hooks/useToast';
import { serveur } from '../../test/serveur';
import AdminProfilePage from '../../pages/admin/account/AdminProfilePage';

describe('Avatar', () => {
  it('montre les initiales quand aucune photo n’est déposée', () => {
    render(<Avatar name="Dylan Menga" />);
    expect(screen.getByText('DM')).toBeTruthy();
  });

  it('montre la photo quand elle existe', () => {
    render(<Avatar name="Dylan Menga" src="/media/avatars/abc.png" />);
    const image = screen.getByRole('img');
    expect(image.getAttribute('src')).toBe('/media/avatars/abc.png');
    // Le nom sert de texte alternatif : « photo de profil » ne dirait pas de qui.
    expect(image.getAttribute('alt')).toBe('Dylan Menga');
  });

  it('retombe sur les initiales si l’image ne charge pas', () => {
    // Fichier effacé, cache périmé, média non servi : le cadre vide de l'image
    // cassée du navigateur serait pire que des initiales.
    render(<Avatar name="Dylan Menga" src="/media/avatars/disparue.png" />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByText('DM')).toBeTruthy();
  });
});

describe('Champ de photo de profil', () => {
  const fichier = (nom, type, taille = 1024) => {
    const item = new File(['x'], nom, { type });
    Object.defineProperty(item, 'size', { value: taille });
    return item;
  };

  /** Le canevas n'existe pas dans jsdom : on lui prête juste ce qu'il faut. */
  const canevasSimule = () => {
    const dessine = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: dessine,
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((rendre) =>
      rendre(new Blob(['image'], { type: 'image/jpeg' })),
    );
    return dessine;
  };

  /** jsdom ne décode aucune image : on annonce ses dimensions à sa place. */
  const chargerApercu = (largeur = 750, hauteur = 1080) => {
    const apercu = screen.getByAltText('Photo à cadrer');
    Object.defineProperty(apercu, 'naturalWidth', { value: largeur, configurable: true });
    Object.defineProperty(apercu, 'naturalHeight', { value: hauteur, configurable: true });
    fireEvent.load(apercu);
    return apercu;
  };

  const deposerFichier = (container, item = fichier('moi.png', 'image/png')) => {
    fireEvent.change(container.querySelector('input[type="file"]'), {
      target: { files: [item] },
    });
  };

  it('propose de cadrer la photo au lieu de l’envoyer telle quelle', () => {
    // Une photo de téléphone est un portrait en pied : rognée au centre, elle
    // gardait le buste et coupait le visage. Personne ne reconnaissait plus
    // personne dans un rond de 44 px.
    const deposer = vi.fn().mockResolvedValue({});
    const { container } = render(
      <AvatarField name="Dylan Menga" src={null} onUpload={deposer} onRemove={vi.fn()} />,
    );

    deposerFichier(container);

    expect(screen.getByText('Cadrer votre photo')).toBeTruthy();
    expect(deposer).not.toHaveBeenCalled();
  });

  it('envoie un carré, et non le fichier d’origine', async () => {
    canevasSimule();
    const deposer = vi.fn().mockResolvedValue({});
    const { container } = render(
      <AvatarField name="Dylan Menga" src={null} onUpload={deposer} onRemove={vi.fn()} />,
    );

    deposerFichier(container);
    chargerApercu();
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer cette photo/ }));

    await waitFor(() => expect(deposer).toHaveBeenCalled());
    const envoye = deposer.mock.calls[0][0];
    expect(envoye.type).toBe('image/jpeg');
    expect(envoye.name).toBe('photo-de-profil.jpg');
  });

  it('découpe le carré choisi dans l’image d’origine', async () => {
    // Sans zoom : le carré centré d'un portrait 750 × 1080, celui-là même que
    // `object-fit: cover` retenait déjà.
    const dessine = canevasSimule();
    const { container } = render(
      <AvatarField name="Dylan Menga" src={null} onUpload={vi.fn()} onRemove={vi.fn()} />,
    );

    deposerFichier(container);
    const apercu = chargerApercu();
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer cette photo/ }));

    expect(dessine).toHaveBeenCalledWith(apercu, 0, 165, 750, 750, 0, 0, 512, 512);
  });

  it('montre le rendu final aux deux tailles où la photo est vue', () => {
    // Le cercle de cadrage fait 288 px : il flatte un plan large que la barre
    // du haut réduit à un point. Sans ces témoins, on ajuste à l'aveugle.
    const { container } = render(
      <AvatarField name="Dylan Menga" src={null} onUpload={vi.fn()} onRemove={vi.fn()} />,
    );

    deposerFichier(container);
    chargerApercu();

    expect(screen.getByText('Barre du haut')).toBeTruthy();
    expect(screen.getByText('Profil')).toBeTruthy();
  });

  it('renonce sans rien envoyer', () => {
    const deposer = vi.fn();
    const { container } = render(
      <AvatarField name="Dylan Menga" src={null} onUpload={deposer} onRemove={vi.fn()} />,
    );

    deposerFichier(container);
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));

    expect(screen.queryByText('Cadrer votre photo')).toBeNull();
    expect(deposer).not.toHaveBeenCalled();
  });

  it('affiche le refus sans vider l’écran', async () => {
    canevasSimule();
    const deposer = vi.fn().mockRejectedValue(new Error('Format refusé : PNG, JPEG ou WebP.'));
    const { container } = render(
      <AvatarField name="Dylan Menga" src={null} onUpload={deposer} onRemove={vi.fn()} />,
    );

    deposerFichier(container, fichier('doc.pdf', 'application/pdf'));
    chargerApercu();
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer cette photo/ }));

    const alerte = await screen.findByRole('alert');
    expect(alerte.textContent).toMatch(/Format refusé/);
  });

  it('ne propose le retrait que s’il y a une photo', () => {
    const { rerender } = render(
      <AvatarField name="Dylan Menga" src={null} onUpload={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: /Retirer/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Ajouter une photo/ })).toBeTruthy();

    rerender(
      <AvatarField name="Dylan Menga" src="/media/a.png" onUpload={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /Retirer/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Changer la photo/ })).toBeTruthy();
  });
});

describe('Menu du compte', () => {
  const rendre = (admin = { firstName: 'Dylan', lastName: 'Menga', email: 'd@ece.fr' }) =>
    // Les mêmes drapeaux que le routeur de l'application : sans eux, le test
    // émet les avertissements de migration v7 que l'application a déjà réglés.
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AdminSessionContext.Provider
          value={{ admin, permissions: [], status: 'connecte', isAuthenticated: true }}
        >
          <AccountMenu onLogout={vi.fn()} />
        </AdminSessionContext.Provider>
      </MemoryRouter>,
    );

  it('annonce son état au lecteur d’écran', () => {
    rendre();
    const declencheur = screen.getByRole('button');
    // L'avatar était un carré de couleur sans nom ni rôle : rien n'indiquait
    // qu'il était actionnable, ni ce qu'il commandait.
    expect(declencheur.getAttribute('aria-haspopup')).toBe('menu');
    expect(declencheur.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(declencheur);
    expect(declencheur.getAttribute('aria-expanded')).toBe('true');
  });

  it('propose les trois destinations du compte', () => {
    rendre();
    fireEvent.click(screen.getByRole('button'));

    const menu = screen.getByRole('menu');
    const entrees = within(menu).getAllByRole('menuitem').map((item) => item.textContent.trim());
    expect(entrees).toEqual([
      'Mon profil et ma photo',
      'Retour à l’espace utilisateur',
      'Déconnexion',
    ]);
  });

  it('se referme sur Échap en rendant le focus', () => {
    // Sans cela, la navigation au clavier se perdrait dans la page derrière le
    // menu refermé.
    rendre();
    const declencheur = screen.getByRole('button');
    fireEvent.click(declencheur);
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(declencheur);
  });

  it('signale le propriétaire', () => {
    rendre({ firstName: 'Dylan', lastName: 'Menga', email: 'd@ece.fr', isOwner: true });
    fireEvent.click(screen.getByRole('button'));
    expect(within(screen.getByRole('menu')).getByText('Propriétaire')).toBeTruthy();
  });
});

describe('Liste des sessions', () => {
  const session = (extra) => ({
    id: 'f-1',
    scope: 'admin',
    ip: '203.0.113.7',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0',
    startedAt: new Date('2026-08-25T09:00:00Z'),
    current: false,
    ...extra,
  });

  it('nomme l’appareil sans prétendre le reconnaître précisément', () => {
    // La chaîne d'agent est déclarative et falsifiable : en tirer « iPhone 14
    // Pro » donnerait à une donnée peu fiable une précision qu'elle n'a pas.
    render(<SessionList sessions={[session()]} onRevokeOthers={vi.fn()} />);
    expect(screen.getByText('Chrome sur Windows')).toBeTruthy();
    expect(screen.getByText('203.0.113.7')).toBeTruthy();
  });

  it('distingue la session qui consulte', () => {
    render(<SessionList sessions={[session({ current: true })]} onRevokeOthers={vi.fn()} />);
    expect(screen.getByText('Cet appareil')).toBeTruthy();
    expect(screen.getByText(/Aucune autre session ouverte/)).toBeTruthy();
  });

  it('compte les autres sessions avant de proposer de les fermer', () => {
    const fermer = vi.fn();
    render(
      <SessionList
        sessions={[session({ current: true }), session({ id: 'f-2' }), session({ id: 'f-3' })]}
        onRevokeOthers={fermer}
      />,
    );

    const bouton = screen.getByRole('button', { name: /Fermer les 2 autres sessions/ });
    fireEvent.click(bouton);
    expect(fermer).toHaveBeenCalled();
  });
});

describe('Écran de profil d’administration', () => {
  const COMPTE = {
    id: 'u-1',
    first_name: 'Dylan',
    last_name: 'Menga',
    email: 'd.menga@ece.fr',
    phone: null,
    promotion: null,
    department: 'Direction',
    badge_number: '20841',
    avatar_url: null,
    status: 'actif',
    preferences: null,
  };

  const monter = () =>
    render(
      <MemoryRouter>
        <ToastProvider>
          <AdminSessionContext.Provider
            value={{
              admin: { id: 'u-1', permissions: [] },
              status: 'ouverte',
              isRestoring: false,
              isAuthenticated: true,
              permissions: [],
              login: vi.fn(),
              logout: vi.fn(),
              setPermissions: vi.fn(),
              refresh: vi.fn().mockResolvedValue(null),
            }}
          >
            <AdminProfilePage />
          </AdminSessionContext.Provider>
        </ToastProvider>
      </MemoryRouter>,
    );

  it('confirme le dépôt de la photo au lieu d’afficher une erreur de code', async () => {
    // L'écran appelait `toast({ tone, title })`, alors que `useToast()` rend un
    // objet — `toast.success`, `toast.error`. L'écriture réussissait, puis
    // l'annonce levait « toast is not a function » : l'erreur remontait dans le
    // champ de photo, sous la forme d'un échec, à côté de la photo déposée.
    const BASE = 'http://localhost:5180/api/v1';
    serveur.use(
      http.get(`${BASE}/users/me`, () => HttpResponse.json(COMPTE)),
      http.get(`${BASE}/users/me/sessions`, () => HttpResponse.json([])),
      http.get(`${BASE}/admin/permissions`, () => HttpResponse.json([])),
      http.put(`${BASE}/users/me/avatar`, () =>
        HttpResponse.json({ ...COMPTE, avatar_url: '/media/avatars/u-1.png' }),
      ),
    );

    const { container } = monter();
    await screen.findByText('Photo de profil');

    // Le dépôt passe désormais par le cadrage : jsdom n'ayant ni canevas ni
    // décodeur d'image, on lui prête l'un et l'autre.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((rendre) =>
      rendre(new Blob(['image'], { type: 'image/jpeg' })),
    );

    const image = new File(['x'], 'moi.png', { type: 'image/png' });
    Object.defineProperty(image, 'size', { value: 1024 });
    fireEvent.change(container.querySelector('input[type="file"]'), {
      target: { files: [image] },
    });

    const apercu = screen.getByAltText('Photo à cadrer');
    Object.defineProperty(apercu, 'naturalWidth', { value: 750, configurable: true });
    Object.defineProperty(apercu, 'naturalHeight', { value: 1080, configurable: true });
    fireEvent.load(apercu);
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer cette photo/ }));

    expect(await screen.findByText('Photo mise à jour')).toBeTruthy();
    // Et surtout : aucun message d'échec dans le champ.
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Barre haute de l’espace utilisateur', () => {
  it('affiche la photo du compte plutôt que ses initiales', () => {
    // La barre rendait `<Avatar name={…} />` sans adresse : la photo déposée
    // n'apparaissait donc jamais, quel que soit le compte.
    render(<Avatar name="Dylan Menga" src="/media/avatars/moi.jpg" />);

    expect(screen.getByRole('img').getAttribute('src')).toBe('/media/avatars/moi.jpg');
    expect(screen.queryByText('DM')).toBeNull();
  });
});

describe('Cadrage de la photo de profil', () => {
  it('rogne par le haut plutôt que par le centre', () => {
    // Une photo de téléphone est un portrait : le rognage centré d'un cadre
    // carré coupait le visage pour garder le buste.
    render(<Avatar name="Dylan Menga" src="/media/avatars/moi.jpg" />);
    expect(screen.getByRole('img').className).toContain('object-top');
  });
})
