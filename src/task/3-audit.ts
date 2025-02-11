interface NodeStatus {
  endpoint: string;
  blockHeight: number;
  responseTime: number;
  timestamp: number;
  gasPrice: string;
  peerCount: number;
  isResponding: boolean;
}

interface StatusSummary {
  timestamp: number;
  roundNumber: number;
  nodes: NodeStatus[];
  networkStats: {
    activeNodes: number;
    averageGasPrice: number;
    highestBlock: number;
  };
}

export async function audit(submissionValue: string): Promise<{ isValid: boolean; score: number }> {
  try {
    const status: StatusSummary = JSON.parse(submissionValue);
    
    // Validation checks
    const checks = {
      // Check if we have data for all nodes
      hasAllNodes: status.nodes.length === 3,
      
      // Check if at least one node is responding
      hasActiveNodes: status.networkStats.activeNodes > 0,
      
      // Check if block heights are reasonable (greater than 0 for responding nodes)
      validBlockHeights: status.nodes
        .filter(node => node.isResponding)
        .every(node => node.blockHeight > 0),
      
      // Check if gas prices are reasonable (between 0.1 and 10000 gwei)
      validGasPrices: status.nodes
        .filter(node => node.isResponding)
        .every(node => {
          const price = parseFloat(node.gasPrice);
          return price >= 0.1 && price <= 10000;
        }),
      
      // Check if timestamps are recent (within last hour)
      validTimestamp: Math.abs(Date.now() - status.timestamp) < 3600000,
      
      // Check if responding nodes have peers
      validPeerCounts: status.nodes
        .filter(node => node.isResponding)
        .every(node => node.peerCount > 0)
    };

    // Calculate score based on number of passing checks
    const passedChecks = Object.values(checks).filter(check => check === true).length;
    const score = passedChecks / Object.keys(checks).length;
    
    // Submission is valid if score is above 0.7 (at least 70% of checks pass)
    const isValid = score >= 0.7;

    console.log('Audit checks:', checks);
    console.log('Score:', score);
    console.log('Submission valid:', isValid);

    return {
      isValid,
      score
    };
  } catch (error) {
    console.error('Error in audit:', error);
    return {
      isValid: false,
      score: 0
    };
  }
}
