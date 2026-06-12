import { lazy, Suspense, Show } from "solid-js";
import { leftbarContentLoaded } from "../State/globalSignals";
import "./CSS/SlidebarLeft.css";
export const SlidebarLeftContent = lazy(() => import("./SlidebarLeftContent"));

export default function SlidebarLeft(props) {
  return (
    <aside class="SlidebarLeft-aside" ref={props.ref}>
      <Show when={leftbarContentLoaded()}>
        <Suspense>
          <SlidebarLeftContent ref={props.leftSB} psr={props.psr} ssr={props.ssr} books={props.books} frozen={props.isDragging} />
        </Suspense>
      </Show>
    </aside>
  );
}
