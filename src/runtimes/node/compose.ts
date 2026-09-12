export interface NodeComposeFragment {
  readonly environment: {
    readonly NODE_VERSION: string
  }
}

export function selectNodeComposeFragment(
  selectedNode: string | null,
): NodeComposeFragment | undefined {
  return selectedNode === null ? undefined : { environment: { NODE_VERSION: selectedNode } }
}
