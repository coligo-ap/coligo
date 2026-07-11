"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
import {
  updateDriverAvatar,
  removeDriverAvatar,
} from "@/app/admin/drivers/actions";
import type { AdminFormState } from "@/app/admin/actions";

/**
 * Photo de profil du livreur (admin) : aperçu rond (photo ou initiales),
 * bouton « appareil photo » → choisit + envoie l'image, bouton « corbeille »
 * → retire la photo. Soumission immédiate à la sélection du fichier.
 */
export function DriverAvatarUpload({
  driverId,
  avatarUrl,
  initials,
}: {
  driverId: string;
  avatarUrl: string | null;
  initials: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const formRef = useRef<HTMLFormElement>(null);
  const [removing, startRemove] = useTransition();
  const [state, formAction, pending] = useActionState<AdminFormState, FormData>(
    updateDriverAvatar.bind(null, driverId),
    {}
  );
  // Aperçu local instantané pendant l'upload.
  const [preview, setPreview] = useState<string | null>(null);
  const [note, setNote] = useActionNote();

  useEffect(() => {
    // Succès : la nouvelle photo s'affiche (feedback visuel) → pas de note.
    if (state.ok) {
      setPreview(null);
      router.refresh();
    } else if (state.error) {
      setNote({ ok: false, text: state.error });
      setPreview(null);
    }
    // setNote est stable (issu d'un useState) — pas besoin en dépendance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, router]);

  const shown = preview ?? avatarUrl;

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col items-center gap-2"
    >
      <div className="relative">
        <div className="bg-primary-100 text-primary-700 grid size-[72px] place-items-center overflow-hidden rounded-full text-xl font-bold">
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shown}
              alt="Photo de profil"
              className="size-full object-cover"
            />
          ) : (
            initials
          )}
          {pending && (
            <div className="absolute inset-0 grid place-items-center bg-black/40">
              <Loader2 className="size-5 animate-spin text-white" />
            </div>
          )}
        </div>

        <label
          className="bg-foreground absolute -right-1 -bottom-1 grid size-7 cursor-pointer place-items-center rounded-full text-white shadow"
          title="Changer la photo"
        >
          <Camera className="size-3.5" />
          <input
            type="file"
            name="avatar"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            disabled={pending}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setPreview(URL.createObjectURL(f));
              formRef.current?.requestSubmit();
            }}
          />
        </label>
      </div>

      {avatarUrl && (
        <button
          type="button"
          disabled={removing || pending}
          className="text-danger-600 inline-flex items-center gap-1 text-xs font-semibold disabled:opacity-50"
          onClick={async () => {
            if (
              !(await confirm({
                title: "Retirer la photo de profil ?",
                confirmLabel: "Retirer",
                danger: true,
              }))
            )
              return;
            startRemove(async () => {
              const r = await removeDriverAvatar(driverId);
              // Succès : la photo disparaît (feedback visuel) → pas de note.
              if (r.error) setNote({ ok: false, text: r.error });
              else router.refresh();
            });
          }}
        >
          {removing ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Trash2 className="size-3" />
          )}
          Retirer
        </button>
      )}
      <ActionNote note={note} />
    </form>
  );
}
