// Documentation contracts; no mapping, inference or control implementation runs here.
export const spatialTypesCode = `interface MapLayer {
  kind: "occupancy" | "surface"; // free/occupied/unknown cells or measured 3D surfaces; different products
  resource: ResourceRef; // exact native encoding/version: e.g. nav_msgs/OccupancyGrid or sensor_msgs/PointCloud2
  observedAt: Timestamp; // newest included acquisition; per-cell/point age and coverage remain in retained provenance
} // Resource payload carries resolution, origin and encoding. A cloud is not an occupancy grid.
interface MapCheckpoint {
  mapId: string; frameId: string; // independent local map and immutable coordinate epoch
  revision: bigint; parentRevision?: bigint; // retained checkpoint lineage
}
interface LocalMapRecord {
  id: string; unitId: string; rootFrameId: string; // durable map identity, originating Unit and immutable frame
  revision: bigint; headRevisionId?: string; createdAt: Timestamp; // committed head, not current localization
}
interface SpatialFrameRecord {
  id: string; unitId?: string; // new identity for each coordinate reset
  kind: "local_map" | "odom" | "body" | "sensor" | "site"; createdAt: Timestamp; // registered frame role
}
interface MapRevisionRecord {
  id: string; mapId: string; revision: bigint; parentRevision?: bigint; // immutable checkpoint lineage
  manifest: ResourceRef; recordedAt: Timestamp; // retained payload and commit time, not sensor freshness
}
interface RegionExtent {
  mapRevision: bigint; // exact retained checkpoint used to delimit this region
  occupancyResourceId: string; // occupancy layer in that checkpoint; establishes grid origin/resolution/frame
  mask: ResourceRef; // sensor_msgs/Image mono8: same grid dimensions and cell ordering; 1 = included, 0 = outside
  coverage: "partial" | "bounded"; // partial is explored extent only; bounded means its boundary is established
} // Image row y matches occupancy row y, with no display-axis flip; validate step/encoding and resource frame.
// This alignment/encoding is Nemeia's convention over ROS messages, not a ROS room standard.
// Bounding a region does not prove every cell is observed, unobstructed or traversable by a Unit.
interface RegionName {
  text: string; assignedBy: Identity; assignedAt: Timestamp; // World Master annotation, not a detector score
}
interface RegionRecord {
  entityId: string; mapId: string; // region reuses Entity identity; neither a label nor a coordinate frame
  revision: bigint; // compare-and-set for extent or name edits; never use map revision as this fence
  extent: RegionExtent; // progressively refined spatial membership, independent of the name
  observationIds: readonly string[]; // retained spatial evidence behind the extent
  name?: RegionName; // absent while unnamed; model proposals stay in semantic.hypotheses
}
interface RegionView {
  region: Readonly<RegionRecord>; // small current component; masks remain in resource storage
  hypotheses: readonly { label: string; score: number }[]; // derived semantic component, not assigned names
  objectIds: readonly string[]; // evidenced located_in relations; not a permanent object-ownership list
  connectedRegionIds: readonly string[]; // evidenced topology, not a claim that a path is safe
} // Region IDs survive renaming and boundary refinement. Split/merge requires explicit identity review.
// Keep old extents and their evidence reachable from mission proofs; renaming never rewrites old findings.`;

export const navigationCode = `type NavigateRequest = Pick<ApproachRequest,
  "executionId" | "unitId" | "assignment" | "acceptBy" | "mission"
> & {
  mapId: string; basisMapRevision: bigint; // checkpoint used to choose the viewpoint; not a frozen safety map
  frameId: string; targetPose: Pose3; // measured-map-derived pose, never coordinates invented from a room name
};
type ActionIntent =
  | { tag: "approach"; value: ApproachRequest } // approach@1: maintain a standoff from an observed entity
  | { tag: "navigate"; value: NavigateRequest }; // navigate@1: reach a specific local pose
interface NavigationResult {
  unitObservationId: string; localReceiptId: string; // final measured pose and durable safe-closure receipt
} // Validate position and heading against installed tolerances; arrival does not prove an inspection result.
type ActionCompletion = Exclude<Completion, { tag: "succeeded" }> | {
  tag: "succeeded";
  value:
    | { tag: "approach"; value: Extract<Completion, { tag: "succeeded" }>["value"] }
    | { tag: "navigate"; value: NavigationResult }; // outcome must match the accepted action
};
// Nemeia's admission envelope wraps a pose-navigation pattern such as Nav2 NavigateToPose.
// The installed adapter supplies the behavior tree, footprint, traversability and motion policy.
// Admission/claim check current localization, grants and permitted exploration bounds.
// Local planning checks live obstacles continuously; a retained map is never a safety clearance.
// A new map revision triggers revalidation, not automatic cancellation on every mapping update.
// Reject a reset frame or an invalidated viewpoint. Unknown space is not implicitly drivable.`;

export function spatialContractCode(id, code) {
  if (id === "request") return code.replace(
    '  requestApproach(input: ApproachRequest)',
    '  requestNavigate(input: NavigateRequest): Promise<void>; // validate local pose, map context and exploration authority; accept navigate@1\n  requestApproach(input: ApproachRequest)');
  if (id === "controller") return code.replace("request: ApproachRequest", "request: ActionIntent");
  if (id === "finish") return code.replace("result: Completion", "result: ActionCompletion");
  if (id === "configuration") return code.replace("installApproach(", "installAction(");
  return code;
}
