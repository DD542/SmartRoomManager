import { useState } from 'react';
import { Modal } from '../ui/Modal';

/**
 * Mosaïque de photos : une vue principale et jusqu'à trois vignettes, la
 * dernière portant le compteur des photos restantes. Ouverture en grand par
 * clic ou par clavier, chaque image reste un bouton accessible.
 */
export function RoomGallery({ photos = [], roomName = 'la salle' }) {
  const [openIndex, setOpenIndex] = useState(null);
  if (photos.length === 0) return null;

  const [main, ...rest] = photos;
  const thumbs = rest.slice(0, 3);
  const remaining = photos.length - 1 - thumbs.length;

  return (
    <>
      <div className="grid gap-2 sm:grid-cols-[2fr_1fr] [&>*]:min-w-0">
        <button
          type="button"
          onClick={() => setOpenIndex(0)}
          className="overflow-hidden rounded-xl border border-line"
          aria-label={`Agrandir la photo principale de ${roomName}`}
        >
          <img src={main} alt={`Vue principale de ${roomName}`} className="h-56 w-full object-cover" />
        </button>

        <div className="grid grid-cols-3 gap-2 sm:grid-cols-1">
          {thumbs.map((photo, index) => (
            <button
              key={index}
              type="button"
              onClick={() => setOpenIndex(index + 1)}
              className="relative overflow-hidden rounded-xl border border-line"
              aria-label={`Agrandir la photo ${index + 2} de ${roomName}`}
            >
              <img
                src={photo}
                alt={`Vue ${index + 2} de ${roomName}`}
                className="h-[68px] w-full object-cover sm:h-[58px]"
              />
              {index === thumbs.length - 1 && remaining > 0 && (
                <span className="absolute inset-0 flex items-center justify-center bg-ink/70 text-xs font-medium text-content">
                  +{remaining} photos
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <Modal
        open={openIndex !== null}
        onClose={() => setOpenIndex(null)}
        title={`Photos — ${roomName}`}
        size="xl"
      >
        <img
          src={photos[openIndex ?? 0]}
          alt={`Vue ${(openIndex ?? 0) + 1} de ${roomName}`}
          className="w-full rounded-xl"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {photos.map((photo, index) => (
            <button
              key={index}
              type="button"
              onClick={() => setOpenIndex(index)}
              aria-current={index === openIndex}
              className={`overflow-hidden rounded-lg border ${
                index === openIndex ? 'border-accent' : 'border-line'
              }`}
            >
              <img src={photo} alt="" className="h-12 w-16 object-cover" />
              <span className="sr-only">Voir la photo {index + 1}</span>
            </button>
          ))}
        </div>
      </Modal>
    </>
  );
}
