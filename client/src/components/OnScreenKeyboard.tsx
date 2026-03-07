import { useMemo, useState } from "react";
import { Delete, CornerDownLeft, Keyboard, X } from "lucide-react";

type KeyboardMode = "alphanumeric" | "text" | "email";

type OnScreenKeyboardProps = {
  value: string;
  onChange: (next: string) => void;
  onEnter?: () => void;
  onClose?: () => void;
  mode?: KeyboardMode;
  forceUppercase?: boolean;
  title?: string;
};

const alphaRows = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
];

const numberRow = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

function keyClassName(extra = "") {
  return `h-11 rounded-xl border border-[#E8E6EB] bg-white px-2 text-sm font-black text-[#024059] shadow-sm active:scale-95 ${extra}`;
}

export function OnScreenKeyboard({
  value,
  onChange,
  onEnter,
  onClose,
  mode = "alphanumeric",
  forceUppercase = false,
  title = "On-screen keyboard",
}: OnScreenKeyboardProps) {
  const [shift, setShift] = useState(forceUppercase);

  const rows = useMemo(() => {
    if (mode === "text" || mode === "email") return alphaRows;
    return alphaRows;
  }, [mode]);

  const applyValue = (next: string) => {
    onChange(forceUppercase ? next.toUpperCase() : next);
  };

  const append = (token: string) => {
    const normalizedToken = shift ? token.toUpperCase() : token;
    applyValue(`${value}${normalizedToken}`);
  };

  const backspace = () => applyValue(value.slice(0, -1));
  const clearAll = () => applyValue("");

  const symbolKeys =
    mode === "email"
      ? ["@", ".", "-", "_", ".com"]
      : mode === "alphanumeric"
      ? ["-", "/", "."]
      : [".", ",", "?", "!", "-"];

  return (
    <div className="fixed inset-x-0 bottom-0 z-[90] border-t border-[#E8E6EB] bg-[#E8E6EB]/95 p-3 shadow-[0_-12px_30px_rgba(2,64,89,0.18)] backdrop-blur-md md:p-4">
      <div className="mx-auto max-w-4xl space-y-3">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[#024059]/70">
            <Keyboard className="h-4 w-4" /> {title}
          </p>
          <button type="button" onClick={onClose} className={keyClassName("h-9 px-3 text-[10px] uppercase tracking-wider")}>
            <X className="mx-auto h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-10 gap-2">
          {numberRow.map((key) => (
            <button key={key} type="button" onClick={() => append(key)} className={keyClassName()}>
              {key}
            </button>
          ))}
        </div>

        {rows.map((row, rowIndex) => (
          <div key={`row-${rowIndex}`} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}>
            {row.map((key) => (
              <button key={key} type="button" onClick={() => append(key)} className={keyClassName()}>
                {shift ? key.toUpperCase() : key}
              </button>
            ))}
          </div>
        ))}

        <div className="grid grid-cols-5 gap-2">
          {symbolKeys.map((key) => (
            <button key={key} type="button" onClick={() => append(key)} className={keyClassName()}>
              {key}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-12 gap-2">
          <button type="button" onClick={() => setShift((prev) => !prev)} className={keyClassName("col-span-2 text-[10px] uppercase tracking-wider")}>
            Shift
          </button>
          <button type="button" onClick={() => append(" ")} className={keyClassName("col-span-5 text-[10px] uppercase tracking-wider")}>
            Space
          </button>
          <button type="button" onClick={backspace} className={keyClassName("col-span-2")}>
            <Delete className="mx-auto h-4 w-4" />
          </button>
          <button type="button" onClick={clearAll} className={keyClassName("col-span-1 text-[10px] uppercase tracking-wider")}>
            C
          </button>
          <button type="button" onClick={onEnter} className={keyClassName("col-span-2 bg-[#024059] text-white")}>
            <CornerDownLeft className="mx-auto h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
