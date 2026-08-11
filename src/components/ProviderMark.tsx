import codexLogo from "../../codex.svg";

interface ProviderMarkProps {
  collapseLabel?: string;
  onCollapse?: () => void;
}

export function ProviderMark({ collapseLabel, onCollapse }: ProviderMarkProps = {}) {
  if (onCollapse && collapseLabel) {
    return (
      <button
        type="button"
        className="provider-mark provider-mark--collapse"
        aria-label={collapseLabel}
        title={collapseLabel}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onCollapse();
        }}
      >
        <img src={codexLogo} alt="" />
      </button>
    );
  }

  return (
    <div className="provider-mark" aria-label="Codex">
      <img src={codexLogo} alt="" />
    </div>
  );
}
