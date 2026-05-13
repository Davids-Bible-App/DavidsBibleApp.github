import { bible1, expanded, setExpanded } from "../State/globalSignals.js";
import "./CSS/RibbonVersion.css";

export default function RibbonVersion(props) {
  return (
    <>
      <div
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setExpanded((expand) => !expand)}
        class="RibbonVersion-aWrap"
      >
        <div class="RibbonVersion-ribbonOuter">
          <div class="RibbonVersion-ribbonInner">
            <span>
              {expanded() ? (
                <b class="RibbonVersion-closeBtn">&nbsp&#10006;&nbsp</b>
              ) : (
                props.getInfo(bible1())?.short_name
              )}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
