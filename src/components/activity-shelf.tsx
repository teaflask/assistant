import type { ReactNode } from "react";

/** The decision shelf holds active approval and question surfaces. */
export function ActivityShelf({
  suspension,
}: {
  /** The suspension slot: the active approval or question surface, on
   *  the full transcript/composer measure. */
  suspension?: ReactNode;
}) {
  return (
    <div
      data-tf-activity-shelf=""
      data-tf-composer-ground=""
      className="tf:bg-tf-background tf:empty:hidden"
    >
      <div className="tf:mx-auto tf:w-full tf:max-w-3xl tf:px-4 tf:empty:hidden">
        <div
          data-tf-suspension-slot=""
          className="tf:flex tf:flex-col tf:gap-2 tf:pt-1 tf:empty:hidden"
        >
          {suspension}
        </div>
      </div>
    </div>
  );
}

/**
 * Floating activity anchored to the top edge of the shelf+composer
 * anchor (Transcript's [data-tf-composer-anchor]) — above the decision
 * shelf when it is populated, directly above the composer when it is
 * empty, so a floating pill can never sit over a pending card's
 * Approve/Deny row. The overlay never catches input;
 * compact interactive tenants opt back in at their own boundary. No
 * background is painted here.
 */
export function ComposerActivityOverlay({
  activity,
}: {
  activity?: ReactNode;
}) {
  return (
    <div
      data-tf-activity-slot=""
      data-tf-composer-activity-overlay=""
      className="tf:pointer-events-none tf:absolute tf:inset-x-0 tf:bottom-full tf:flex tf:flex-col tf:items-center tf:gap-1.5 tf:pb-4 tf:empty:hidden"
    >
      {activity}
    </div>
  );
}
