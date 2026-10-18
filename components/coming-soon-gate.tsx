import type { ReactNode } from "react";
import { FEATURES, type FeatureId } from "./app-routes";

export function ComingSoonGate({ feature, children }: { feature: FeatureId; children: ReactNode }) {
  const { label } = FEATURES[feature];
  const contextId = `coming-soon-${feature}-context`;
  const titleId = `coming-soon-${feature}-title`;

  return (
    <div className="coming-soon-gate">
      <div className="coming-soon-preview" inert aria-hidden="true">
        {children}
      </div>
      <div className="coming-soon-overlay">
        <section className="coming-soon-card" aria-labelledby={`${contextId} ${titleId}`}>
          <p className="coming-soon-context" id={contextId}>{label}</p>
          <h1 id={titleId}>Coming soon</h1>
          <p className="coming-soon-description">We’re working on this. Check back soon.</p>
        </section>
      </div>
    </div>
  );
}
