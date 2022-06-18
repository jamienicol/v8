// Copyright 2022 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { Phase, PhaseType } from "../phase";
import { TurboshaftGraphNode } from "./turboshaft-graph-node";
import { TurboshaftGraphEdge } from "./turboshaft-graph-edge";
import { TurboshaftGraphBlock } from "./turboshaft-graph-block";

export class TurboshaftGraphPhase extends Phase {
  highestBlockId: number;
  data: TurboshaftGraphData;
  nodeIdToNodeMap: Array<TurboshaftGraphNode>;
  blockIdToBlockMap: Array<TurboshaftGraphBlock>;

  constructor(name: string, highestBlockId: number, data?: TurboshaftGraphData,
              nodeIdToNodeMap?: Array<TurboshaftGraphNode>,
              blockIdToBlockMap?: Array<TurboshaftGraphBlock>) {
    super(name, PhaseType.TurboshaftGraph);
    this.highestBlockId = highestBlockId;
    this.data = data ?? new TurboshaftGraphData();
    this.nodeIdToNodeMap = nodeIdToNodeMap ?? new Array<TurboshaftGraphNode>();
    this.blockIdToBlockMap = blockIdToBlockMap ?? new Array<TurboshaftGraphBlock>();
  }

  public parseDataFromJSON(dataJson): void {
    this.data = new TurboshaftGraphData();
    this.parseBlocksFromJSON(dataJson.blocks);
    this.parseNodesFromJSON(dataJson.nodes);
    this.parseEdgesFromJSON(dataJson.edges);
  }

  private parseBlocksFromJSON(blocksJson): void {
    for (const blockJson of blocksJson) {
      const block = new TurboshaftGraphBlock(blockJson.id, blockJson.type,
        blockJson.deferred, blockJson.predecessors);
      this.data.blocks.push(block);
      this.blockIdToBlockMap[block.id] = block;
    }
  }

  private parseNodesFromJSON(nodesJson): void {
    for (const nodeJson of nodesJson) {
      const block = this.blockIdToBlockMap[nodeJson.block_id];
      const node = new TurboshaftGraphNode(nodeJson.id, nodeJson.title,
        block, nodeJson.properties);
      block.nodes.push(node);
      this.data.nodes.push(node);
      this.nodeIdToNodeMap[node.id] = node;
    }
  }

  private parseEdgesFromJSON(edgesJson): void {
    for (const edgeJson of edgesJson) {
      const target = this.nodeIdToNodeMap[edgeJson.target];
      const source = this.nodeIdToNodeMap[edgeJson.source];
      const edge = new TurboshaftGraphEdge(target, source);
      this.data.edges.push(edge);
      target.inputs.push(edge);
      source.outputs.push(edge);
    }
  }
}

export class TurboshaftGraphData {
  nodes: Array<TurboshaftGraphNode>;
  edges: Array<TurboshaftGraphEdge>;
  blocks: Array<TurboshaftGraphBlock>;

  constructor(nodes?: Array<TurboshaftGraphNode>, edges?: Array<TurboshaftGraphEdge>,
              blocks?: Array<TurboshaftGraphBlock>) {
    this.nodes = nodes ?? new Array<TurboshaftGraphNode>();
    this.edges = edges ?? new Array<TurboshaftGraphEdge>();
    this.blocks = blocks ?? new Array<TurboshaftGraphBlock>();
  }
}
