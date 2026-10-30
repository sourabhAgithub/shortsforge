import { Loader2, Upload } from "lucide-react";
import { useRef } from "react";

/** Button that opens a file picker and hands back the chosen file. */
export default function FileButton({
  accept,
  busy,
  label,
  onFile,
}: {
  accept: string;
  busy: boolean;
  label: string;
  onFile: (f: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        onClick={() => ref.current?.click()}
        disabled={busy}
        className="btn-ghost"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Upload className="size-4" />
        )}{" "}
        {label}
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </>
  );
}
