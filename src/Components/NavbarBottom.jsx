import handlePageChange from "../lib/handlePageChange.js";
import MenuBtn from "./MenuBtn.jsx";
import RibbonBanner from "./RibbonBanner";
import { settings } from "../State/settingsStore.js";
import { toggleSheet } from "../State/sheetStore";
import { createGesture } from "../lib/gestureHandler.js";
import { preloadSheet } from "../State/sheetComponents";
import "./CSS/NavbarBottom.css";

export default function NavbarBottom(props) {
  const stitchPos = "bottom";

  const preloadNavSheets = () => {
    [settings.navBotSwipe1, settings.navBotSwipe2, settings.navBotDblClick, settings.navBotLongPress].forEach((pref) => {
      const sheet = pref?.split(":")[0];
      if (sheet && sheet !== "none") preloadSheet(sheet);
    });
  };

  const parseGesture = (prefString) => {
    const [sheet, size] = prefString.split(":");
    return { sheet, size };
  };

  const navGestures = createGesture({
    onSwipe1Up: () => {
      const { sheet, size } = parseGesture(settings.navBotSwipe1);
      if (sheet !== "none") toggleSheet(sheet, size);
    },
    onSwipe2Up: () => {
      const { sheet, size } = parseGesture(settings.navBotSwipe2);
      if (sheet !== "none") toggleSheet(sheet, size);
    },
    onDblClick: () => {
      const { sheet, size } = parseGesture(settings.navBotDblClick);
      if (sheet !== "none") toggleSheet(sheet, size);
    },
    onLongPress: () => {
      const { sheet, size } = parseGesture(settings.navBotLongPress);
      if (sheet !== "none") toggleSheet(sheet, size);
    },
  });

  return (
    <>
      <footer class="NavbarBottom-footer">
        {/* Spread the gesture events onto the nav container */}
        <nav
          {...navGestures}
          onPointerEnter={preloadNavSheets}
          onPointerDown={(e) => {
            preloadNavSheets();
            navGestures.onPointerDown(e);
          }}
        >
          <RibbonBanner stitchPos={stitchPos}>
            <content>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  handlePageChange(-1, {
                    books: () => props.books(),
                    psr: props.psr,
                    ssr: props.ssr,
                  });
                  e.stopPropagation();
                }}
                class="NavbarBottom-pageDown"
              >
                &lsaquo;
              </button>
              <button
                class="ctl-L neu-button"
                onPointerEnter={() => preloadSheet("history")}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation(); // Prevents nav gestures from firing on this button click
                  toggleSheet("history", "Mid");
                }}
              >
                <svg width="16px" height="16px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2.75C6.89137 2.75 2.75 6.89137 2.75 12C2.75 17.1086 6.89137 21.25 12 21.25C17.1086 21.25 21.25 17.1086 21.25 12C21.25 6.89137 17.1086 2.75 12 2.75ZM1.25 12C1.25 6.06294 6.06294 1.25 12 1.25C17.9371 1.25 22.75 6.06294 22.75 12C22.75 17.9371 17.9371 22.75 12 22.75C6.06294 22.75 1.25 17.9371 1.25 12ZM12 7.25C12.4142 7.25 12.75 7.58579 12.75 8V11.6893L15.0303 13.9697C15.3232 14.2626 15.3232 14.7374 15.0303 15.0303C14.7374 15.3232 14.2626 15.3232 13.9697 15.0303L11.4697 12.5303C11.329 12.3897 11.25 12.1989 11.25 12V8C11.25 7.58579 11.5858 7.25 12 7.25Z" fill="currentColor" />
                </svg>
              </button>
              <div class="NavbarBottom-txt" style={stitchPos === "top" ? "margin-block: 8px 0;" : "margin-block: 0 6px;"}>
                <div class="NavbarBottom-box">
                  <span class="NavbarBottom-burnInText">{settings.firstName}'s Bible App</span>
                </div>
              </div>
              <MenuBtn showSettings={props.showSettings} setShowSettings={props.setShowSettings} setTouchActionRestored={props.setTouchActionRestored} />
              <button
                class="NavbarBottom-pageUp"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  handlePageChange(1, {
                    books: () => props.books(),
                    psr: props.psr,
                    ssr: props.ssr,
                  });
                  e.stopPropagation();
                }}
              >
                &rsaquo;
              </button>
            </content>
          </RibbonBanner>
        </nav>
      </footer>
    </>
  );
}
