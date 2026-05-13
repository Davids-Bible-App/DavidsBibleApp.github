import "./CSS/RibbonBanner.css";
import { activePaper } from "../State/globalSignals.js";

export default function RibbonBanner(props) {
  return (
    <>
      <div class="RibbonBanner-ribbon" classList={{ bannerOverlay: activePaper() }}>
        <div class="RibbonBanner-ribbon-stitches" style={`background-position: 0 ${props.stitchPos};`}></div>
        <div class="RibbonBanner-ribbon-content">{props.children}</div>
      </div>
    </>
  );
}
