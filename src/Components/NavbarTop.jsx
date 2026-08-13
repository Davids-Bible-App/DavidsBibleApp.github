import RibbonBanner from "./RibbonBanner";
import RibbonVersion from "./RibbonVersion";
import { toggleSheet } from "../State/sheetStore";
import { settings } from "../State/settingsStore.js";
import { createGesture } from "../lib/gestureHandler.js";
import { preloadSheet } from "../State/sheetComponents";
import "./CSS/NavbarTop.css";
import { bible1, bible2, book, chapterNo, setTrigger } from "../State/globalSignals.js";
import { SlidebarLeftContent } from "./SlidebarLeft";
import { GalleryManager } from "./SlidebarRight";
import { setLeftbarContentLoaded, setRightbarContentLoaded, consecutiveDaysData } from "../State/globalSignals";
import ConsecutiveDays from "./ConsecutiveDays.jsx";
import StreakBadge from "./StreakBadge.jsx";
export default function NavbarTop(props) {
  const stitchPos = "top";

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
    onSwipe1Down: () => {
      const { sheet, size } = parseGesture(settings.navTopSwipe1);
      if (sheet !== "none") toggleSheet(sheet, size);
    },
    onSwipe2Down: () => {
      const { sheet, size } = parseGesture(settings.navTopSwipe2);
      if (sheet !== "none") toggleSheet(sheet, size);
    },
    onDblClick: () => {
      const { sheet, size } = parseGesture(settings.navTopDblClick);
      if (sheet !== "none") toggleSheet(sheet, size);
    },
    onLongPress: () => {
      const { sheet, size } = parseGesture(settings.navTopLongPress);
      if (sheet !== "none") toggleSheet(sheet, size);
    },
  });

  return (
    <>
      <header class="NavbarTop-header">
        <nav
          {...navGestures}
          onPointerEnter={preloadNavSheets}
          onPointerDown={(e) => {
            preloadNavSheets();
            navGestures.onPointerDown(e);
          }}
        >
          <RibbonBanner stitchPos={stitchPos}>
            <ConsecutiveDays onUpdate={(data) => /*console.log("[Streak update]", data) */ {}} />
            <Show when={!props.isSecondaryVisible()}>
              <RibbonVersion getInfo={props.getInfo} />
            </Show>
            <content>
              <button
                class="neu-button"
                onPointerEnter={() => SlidebarLeftContent.preload()}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setLeftbarContentLoaded(true);
                  SlidebarLeftContent.preload();
                }}
                onClick={(e) => {
                  setTrigger((prev) => (prev === "left" ? "" : "left"));
                  e.stopPropagation();
                }}
                id="NavbarTop-left"
              >
                <svg width="18px" height="18px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" transform="matrix(-1, 0, 0, 1, 0, 0)">
                  <path d="M5.5 9.25C5.08579 9.25 4.75 9.58579 4.75 10C4.75 10.4142 5.08579 10.75 5.5 10.75H11.5C11.9142 10.75 12.25 10.4142 12.25 10C12.25 9.58579 11.9142 9.25 11.5 9.25H5.5Z" fill="currentColor" />
                  <path d="M5.75 14C5.75 13.5858 6.08579 13.25 6.5 13.25H10.5C10.9142 13.25 11.25 13.5858 11.25 14C11.25 14.4142 10.9142 14.75 10.5 14.75H6.5C6.08579 14.75 5.75 14.4142 5.75 14Z" fill="currentColor" />
                  <path
                    fill-rule="evenodd"
                    clip-rule="evenodd"
                    d="M9.94358 2.25C8.10583 2.24998 6.65019 2.24997 5.51098 2.40314C4.33856 2.56076 3.38961 2.89288 2.64124 3.64124C1.89288 4.38961 1.56076 5.33856 1.40314 6.51098C1.24997 7.65019 1.24998 9.10582 1.25 10.9436V13.0564C1.24998 14.8942 1.24997 16.3498 1.40314 17.489C1.56076 18.6614 1.89288 19.6104 2.64124 20.3588C3.38961 21.1071 4.33856 21.4392 5.51098 21.5969C6.65018 21.75 8.1058 21.75 9.94354 21.75H14.0564C14.3706 21.75 14.6738 21.75 14.966 21.7492C14.9773 21.7497 14.9886 21.75 15 21.75C15.0129 21.75 15.0257 21.7497 15.0384 21.749C16.4224 21.7448 17.5607 21.7217 18.489 21.5969C19.6614 21.4392 20.6104 21.1071 21.3588 20.3588C22.1071 19.6104 22.4392 18.6614 22.5969 17.489C22.75 16.3498 22.75 14.8942 22.75 13.0565V10.9436C22.75 9.10585 22.75 7.65018 22.5969 6.51098C22.4392 5.33856 22.1071 4.38961 21.3588 3.64124C20.6104 2.89288 19.6614 2.56076 18.489 2.40314C17.5607 2.27833 16.4224 2.25523 15.0384 2.25096C15.0257 2.25032 15.0129 2.25 15 2.25C14.9886 2.25 14.9773 2.25025 14.966 2.25076C14.6737 2.25 14.3707 2.25 14.0564 2.25H9.94358ZM14.25 3.75002C14.1677 3.75 14.0844 3.75 14 3.75H10C8.09318 3.75 6.73851 3.75159 5.71085 3.88976C4.70476 4.02503 4.12511 4.27869 3.7019 4.7019C3.27869 5.12511 3.02503 5.70476 2.88976 6.71085C2.75159 7.73851 2.75 9.09318 2.75 11V13C2.75 14.9068 2.75159 16.2615 2.88976 17.2892C3.02503 18.2952 3.27869 18.8749 3.7019 19.2981C4.12511 19.7213 4.70476 19.975 5.71085 20.1102C6.73851 20.2484 8.09318 20.25 10 20.25H14C14.0844 20.25 14.1677 20.25 14.25 20.25L14.25 3.75002ZM15.75 20.2443C16.7836 20.2334 17.6082 20.2018 18.2892 20.1102C19.2952 19.975 19.8749 19.7213 20.2981 19.2981C20.7213 18.8749 20.975 18.2952 21.1102 17.2892C21.2484 16.2615 21.25 14.9068 21.25 13V11C21.25 9.09318 21.2484 7.73851 21.1102 6.71085C20.975 5.70476 20.7213 5.12511 20.2981 4.7019C19.8749 4.27869 19.2952 4.02503 18.2892 3.88976C17.6082 3.79821 16.7836 3.76662 15.75 3.75573L15.75 20.2443Z"
                    fill="currentColor"
                  />
                </svg>
              </button>
              <button
                onPointerEnter={() => preloadSheet("search")}
                onPointerDown={(e) => e.stopPropagation()}
                class="NavbarTop-search neu-button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSheet("search", "Mid");
                }}
                id="NavbarTop-SrcTog"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" class="bi bi-search" viewBox="0 0 18 18">
                  <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0" />
                </svg>
              </button>

              <Show when={(props.orientation() === "vertical" && props.isSecondaryVisible()) || !settings.titleView}>
                <div class="NavbarTop-bookChap" style={!props.isSecondaryVisible() && !settings.titleView && "top: 23px;"}>
                  <b>
                    <span>{book()}</span>
                    &nbsp;
                    <span>{chapterNo()}</span>
                  </b>
                </div>
              </Show>
              <div style={props.isSecondaryVisible() ? (props.orientation() === "vertical" ? "flex-direction: column" : "flex-direction: row") : "flex-direction: row"} class="NavbarTop-bibleTitles">
                <Show when={!props.isSecondaryVisible()}>
                  <div class="NavbarTop-txtBible0">
                    <b>{props.getInfo(bible1())?.english_name}</b>
                  </div>
                </Show>
                <Show when={props.isSecondaryVisible()}>
                  <div class="NavbarTop-txtBible1">
                    <b>{props.getInfo(bible1())?.english_name}</b>
                  </div>
                  <div class="NavbarTop-txtBible2">
                    <b>{props.getInfo(bible2())?.english_name}</b>
                  </div>
                </Show>
              </div>
              <Show when={props.orientation() === "vertical" || !props.isSecondaryVisible()}>
                <StreakBadge />
              </Show>
              <button
                class="neu-button"
                onPointerDown={(e) => e.stopPropagation()}
                style={props.isSecondaryVisible() && props.orientation() === "horizontal" ? "right: unset" : "right: 2.5rem"}
                onClick={(e) => {
                  props.toggleSecondaryPanel();
                  props.psr() && props.psr().scrollTo({ top: 0 });
                  e.stopPropagation();
                }}
                id="NavbarTop-splitPane"
              >
                <Show when={!props.isSecondaryVisible()}>
                  <svg width="18px" height="18px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                      fill-rule="evenodd"
                      clip-rule="evenodd"
                      d="M16.52 5.27261C17.7923 5.21011 18.75 6.25695 18.75 7.45154V12.9108C18.75 14.1716 17.7316 15.1365 16.5459 15.2249C16.0529 15.2617 15.5551 15.3216 15.178 15.4138C14.4402 15.594 13.4666 16.0647 12.857 16.3858C12.3214 16.6681 11.6786 16.6681 11.143 16.3858C10.5334 16.0647 9.55979 15.594 8.82199 15.4138C8.44487 15.3216 7.94708 15.2617 7.45414 15.2249C6.26836 15.1365 5.25 14.1716 5.25 12.9108V7.49649C5.25 6.27528 6.248 5.21817 7.54194 5.31291C8.06744 5.35139 8.67286 5.41879 9.17802 5.54222C10.0998 5.76744 11.1985 6.30646 11.8132 6.6291C11.9157 6.6829 12.0434 6.68078 12.1463 6.62125C12.7018 6.29984 13.6675 5.77873 14.4997 5.54804C15.1227 5.37535 15.8904 5.30353 16.52 5.27261ZM17.25 7.45154C17.25 7.03391 16.9314 6.7542 16.5935 6.7708C15.9907 6.80041 15.3582 6.86663 14.9003 6.99354C14.2696 7.16839 13.4487 7.6007 12.8975 7.91959C12.8493 7.94749 12.8001 7.97306 12.75 7.99628V14.7586C13.3591 14.4625 14.1393 14.1234 14.822 13.9566C15.3199 13.835 15.9149 13.7678 16.4343 13.7291C16.9097 13.6936 17.25 13.3157 17.25 12.9108V7.45154ZM11.116 7.95726C11.16 7.98035 11.2047 8.00154 11.25 8.02081V14.7586C10.6409 14.4625 9.86071 14.1234 9.17802 13.9566C8.68009 13.835 8.08508 13.7678 7.56568 13.7291C7.09031 13.6936 6.75 13.3157 6.75 12.9108V7.49649C6.75 7.06975 7.08277 6.78331 7.4324 6.80891C7.9319 6.84548 8.43898 6.90578 8.82199 6.99936C9.54804 7.17676 10.5035 7.63574 11.116 7.95726Z"
                      fill="currentColor"
                    />
                    <path
                      fill-rule="evenodd"
                      clip-rule="evenodd"
                      d="M9.94358 0.25C8.10583 0.249985 6.65019 0.249973 5.51098 0.403136C4.33856 0.560764 3.38961 0.892881 2.64124 1.64124C1.89288 2.38961 1.56076 3.33856 1.40314 4.51098C1.24997 5.65019 1.24998 7.10582 1.25 8.94357V13.0564C1.24998 14.8942 1.24997 16.3498 1.40314 17.489C1.56076 18.6614 1.89288 19.6104 2.64124 20.3588C3.38961 21.1071 4.33856 21.4392 5.51098 21.5969C6.65018 21.75 8.1058 21.75 9.94354 21.75H14.0564C15.8942 21.75 17.3498 21.75 18.489 21.5969C19.6614 21.4392 20.6104 21.1071 21.3588 20.3588C22.1071 19.6104 22.4392 18.6614 22.5969 17.489C22.75 16.3498 22.75 14.8942 22.75 13.0565V8.94359C22.75 7.10585 22.75 5.65018 22.5969 4.51098C22.4392 3.33856 22.1071 2.38961 21.3588 1.64124C20.6104 0.892881 19.6614 0.560764 18.489 0.403136C17.3498 0.249973 15.8942 0.249985 14.0564 0.25H9.94358ZM3.7019 2.7019C4.12511 2.27869 4.70476 2.02503 5.71085 1.88976C6.73851 1.75159 8.09318 1.75 10 1.75H14C15.9068 1.75 17.2615 1.75159 18.2892 1.88976C19.2952 2.02503 19.8749 2.27869 20.2981 2.7019C20.7213 3.12511 20.975 3.70476 21.1102 4.71085C21.2484 5.73851 21.25 7.09318 21.25 9V13C21.25 14.9068 21.2484 16.2615 21.1102 17.2892C20.975 18.2952 20.7213 18.8749 20.2981 19.2981C19.8749 19.7213 19.2952 19.975 18.2892 20.1102C17.2615 20.2484 15.9068 20.25 14 20.25H10C8.09318 20.25 6.73851 20.2484 5.71085 20.1102C4.70476 19.975 4.12511 19.7213 3.7019 19.2981C3.27869 18.8749 3.02503 18.2952 2.88976 17.2892C2.75159 16.2615 2.75 14.9068 2.75 13V9C2.75 7.09318 2.75159 5.73851 2.88976 4.71085C3.02503 3.70476 3.27869 3.12511 3.7019 2.7019Z"
                      fill="currentColor"
                    />
                  </svg>
                </Show>
                <Show when={props.isSecondaryVisible()}>
                  <svg id="splitBtnOrientation" style={props.isSecondaryVisible() && props.orientation() === "horizontal" && "transform: rotate(90deg)"} width="18px" height="18px" viewBox="0 0 800 800" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <g transform="matrix(33.333333,0,0,33.333333,0,0)">
                      <path
                        d="M11.943,1.25L12.057,1.25C14.366,1.25 16.175,1.25 17.586,1.44C19.031,1.634 20.171,2.039 21.066,2.934C21.961,3.829 22.366,4.969 22.56,6.414C22.75,7.825 22.75,9.634 22.75,11.943L22.75,12.057C22.75,14.366 22.75,16.175 22.56,17.586C22.366,19.031 21.961,20.171 21.066,21.066C20.171,21.961 19.031,22.366 17.586,22.56C16.175,22.75 14.366,22.75 12.057,22.75L11.943,22.75C9.634,22.75 7.825,22.75 6.414,22.56C4.969,22.366 3.829,21.961 2.934,21.066C2.039,20.171 1.634,19.031 1.44,17.586C1.25,16.175 1.25,14.366 1.25,12.057L1.25,11.943C1.25,9.634 1.25,7.825 1.44,6.414C1.634,4.969 2.039,3.829 2.934,2.934C3.829,2.039 4.969,1.634 6.414,1.44C7.825,1.25 9.634,1.25 11.943,1.25ZM6.614,2.926C5.335,3.098 4.564,3.425 3.995,3.995C3.425,4.564 3.098,5.335 2.926,6.614C2.752,7.914 2.75,9.622 2.75,12C2.75,14.378 2.752,16.086 2.926,17.386C3.098,18.665 3.425,19.436 3.995,20.005C4.564,20.575 5.335,20.902 6.614,21.074C7.914,21.248 9.622,21.25 12,21.25C14.378,21.25 16.086,21.248 17.386,21.074C18.665,20.902 19.436,20.575 20.005,20.005C20.575,19.436 20.902,18.665 21.074,17.386C21.248,16.086 21.25,14.378 21.25,12C21.25,9.622 21.248,7.914 21.074,6.614C20.902,5.335 20.575,4.564 20.005,3.995C19.436,3.425 18.665,3.098 17.386,2.926C16.086,2.752 14.378,2.75 12,2.75C9.622,2.75 7.914,2.752 6.614,2.926Z"
                        fill="currentColor"
                      />
                    </g>
                    <g transform="matrix(1.089419,0,0,1,-69.244442,23.958335)">
                      <rect x="81.25" y="352.083" width="698.958" height="47.917" fill="currentColor" />
                    </g>
                  </svg>
                </Show>
              </button>
              <button
                class="neu-button"
                onPointerEnter={() => GalleryManager.preload()}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setRightbarContentLoaded(true);
                  GalleryManager.preload();
                }}
                onClick={(e) => {
                  setTrigger((prev) => (prev === "right" ? "" : "right"));
                  e.stopPropagation();
                }}
                id="NavbarTop-right"
              >
                <svg width="18px" height="18px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" transform="matrix(1, 0, 0, 1, 0, 0)">
                  <path d="M5.5 9.25C5.08579 9.25 4.75 9.58579 4.75 10C4.75 10.4142 5.08579 10.75 5.5 10.75H11.5C11.9142 10.75 12.25 10.4142 12.25 10C12.25 9.58579 11.9142 9.25 11.5 9.25H5.5Z" fill="currentColor" />
                  <path d="M5.75 14C5.75 13.5858 6.08579 13.25 6.5 13.25H10.5C10.9142 13.25 11.25 13.5858 11.25 14C11.25 14.4142 10.9142 14.75 10.5 14.75H6.5C6.08579 14.75 5.75 14.4142 5.75 14Z" fill="currentColor" />
                  <path
                    fill-rule="evenodd"
                    clip-rule="evenodd"
                    d="M9.94358 2.25C8.10583 2.24998 6.65019 2.24997 5.51098 2.40314C4.33856 2.56076 3.38961 2.89288 2.64124 3.64124C1.89288 4.38961 1.56076 5.33856 1.40314 6.51098C1.24997 7.65019 1.24998 9.10582 1.25 10.9436V13.0564C1.24998 14.8942 1.24997 16.3498 1.40314 17.489C1.56076 18.6614 1.89288 19.6104 2.64124 20.3588C3.38961 21.1071 4.33856 21.4392 5.51098 21.5969C6.65018 21.75 8.1058 21.75 9.94354 21.75H14.0564C14.3706 21.75 14.6738 21.75 14.966 21.7492C14.9773 21.7497 14.9886 21.75 15 21.75C15.0129 21.75 15.0257 21.7497 15.0384 21.749C16.4224 21.7448 17.5607 21.7217 18.489 21.5969C19.6614 21.4392 20.6104 21.1071 21.3588 20.3588C22.1071 19.6104 22.4392 18.6614 22.5969 17.489C22.75 16.3498 22.75 14.8942 22.75 13.0565V10.9436C22.75 9.10585 22.75 7.65018 22.5969 6.51098C22.4392 5.33856 22.1071 4.38961 21.3588 3.64124C20.6104 2.89288 19.6614 2.56076 18.489 2.40314C17.5607 2.27833 16.4224 2.25523 15.0384 2.25096C15.0257 2.25032 15.0129 2.25 15 2.25C14.9886 2.25 14.9773 2.25025 14.966 2.25076C14.6737 2.25 14.3707 2.25 14.0564 2.25H9.94358ZM14.25 3.75002C14.1677 3.75 14.0844 3.75 14 3.75H10C8.09318 3.75 6.73851 3.75159 5.71085 3.88976C4.70476 4.02503 4.12511 4.27869 3.7019 4.7019C3.27869 5.12511 3.02503 5.70476 2.88976 6.71085C2.75159 7.73851 2.75 9.09318 2.75 11V13C2.75 14.9068 2.75159 16.2615 2.88976 17.2892C3.02503 18.2952 3.27869 18.8749 3.7019 19.2981C4.12511 19.7213 4.70476 19.975 5.71085 20.1102C6.73851 20.2484 8.09318 20.25 10 20.25H14C14.0844 20.25 14.1677 20.25 14.25 20.25L14.25 3.75002ZM15.75 20.2443C16.7836 20.2334 17.6082 20.2018 18.2892 20.1102C19.2952 19.975 19.8749 19.7213 20.2981 19.2981C20.7213 18.8749 20.975 18.2952 21.1102 17.2892C21.2484 16.2615 21.25 14.9068 21.25 13V11C21.25 9.09318 21.2484 7.73851 21.1102 6.71085C20.975 5.70476 20.7213 5.12511 20.2981 4.7019C19.8749 4.27869 19.2952 4.02503 18.2892 3.88976C17.6082 3.79821 16.7836 3.76662 15.75 3.75573L15.75 20.2443Z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            </content>
          </RibbonBanner>
        </nav>
      </header>
    </>
  );
}
