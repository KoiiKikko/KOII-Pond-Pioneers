import { namespaceWrapper } from "@_koii/namespace-wrapper";
import Web3 from 'web3';

// PulseChain mainnet RPC endpoints
const PULSECHAIN_NODES = [
  'https://rpc.pulsechain.com',
  'https://pulsechain.publicnode.com',
  'https://rpc-pulsechain.g4mm4.io'
];

interface NodeStatus {
  endpoint: string;
  blockHeight: number;
  responseTime: number;
  timestamp: number;
  gasPrice: string;
  peerCount: number;
  isResponding: boolean;
}

async function checkNodeStatus(endpoint: string): Promise<NodeStatus> {
  const startTime = Date.now();
  try {
    const web3 = new Web3(endpoint);
    
    // Make all requests in parallel for efficiency
    const [blockNumber, gasPrice, peerCount] = await Promise.all([
      web3.eth.getBlockNumber(),
      web3.eth.getGasPrice(),
      web3.eth.net.getPeerCount()
    ]);

    // Get the latest block details
    const block = await web3.eth.getBlock(blockNumber);
    
    return {
      endpoint,
      blockHeight: blockNumber,
      responseTime: Date.now() - startTime,
      timestamp: block.timestamp as number,
      gasPrice: web3.utils.fromWei(gasPrice, 'gwei'),
      peerCount,
      isResponding: true
    };
  } catch (error) {
    console.error(`Error checking node ${endpoint}:`, error);
    return {
      endpoint,
      blockHeight: 0,
      responseTime: -1,
      timestamp: 0,
      gasPrice: '0',
      peerCount: 0,
      isResponding: false
    };
  }
}

export async function task(roundNumber: number): Promise<void> {
  try {
    console.log(`EXECUTE PULSECHAIN NODE STATUS CHECK FOR ROUND ${roundNumber}`);
    
    // Check all nodes in parallel
    const statusPromises = PULSECHAIN_NODES.map(node => checkNodeStatus(node));
    const results = await Promise.all(statusPromises);
    
    // Create a summary of results
    const summary = {
      timestamp: Date.now(),
      roundNumber,
      nodes: results,
      networkStats: {
        activeNodes: results.filter(r => r.isResponding).length,
        averageGasPrice: results
          .filter(r => r.isResponding)
          .reduce((acc, curr) => acc + parseFloat(curr.gasPrice), 0) / results.filter(r => r.isResponding).length,
        highestBlock: Math.max(...results.map(r => r.blockHeight))
      }
    };

    // Store the results
    await namespaceWrapper.storeSet(
      `pulsechain_status_${roundNumber}`,
      JSON.stringify(summary)
    );

    console.log('PulseChain Status Summary:', {
      activeNodes: summary.networkStats.activeNodes,
      averageGasPrice: summary.networkStats.averageGasPrice.toFixed(2) + ' gwei',
      highestBlock: summary.networkStats.highestBlock
    });
  } catch (error) {
    console.error("EXECUTE TASK ERROR:", error);
    throw error;
  }
}
