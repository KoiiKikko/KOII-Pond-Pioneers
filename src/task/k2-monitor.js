import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import fetch from 'node-fetch';

// Configuration
const CONFIG = {
    checkInterval: 30, // seconds between checks
    alertThresholds: {
        responseTime: 3000, // ms
        blockStall: 60, // seconds without new blocks
        minStake: 1, // minimum stake in KOII
        maxTransactionCost: 0.1 // maximum transaction cost in KOII
    }
};

// K2 Network RPC endpoints
const K2_NODES = [
    'https://k2-mainnet.koii.live',
    'https://k2-testnet.koii.live',
    // Add more K2 nodes as they become available
];

// Store previous check results for comparison
let previousCheck = null;

async function checkNodeStatus(endpoint) {
    const startTime = Date.now();
    try {
        const connection = new Connection(endpoint);
        
        // Make all requests in parallel for efficiency
        const [
            blockHeight,
            supply,
            health,
            version,
            performance
        ] = await Promise.all([
            connection.getSlot(),
            connection.getSupply(),
            fetch(`${endpoint}/health`).then(res => res.ok),
            connection.getVersion(),
            connection.getRecentPerformanceSamples(1)
        ]);

        // Get recent block info
        const block = await connection.getConfirmedBlock(blockHeight);
        
        return {
            endpoint,
            blockHeight,
            responseTime: Date.now() - startTime,
            timestamp: Date.now(),
            totalSupply: supply.total,
            circulatingSupply: supply.circulating,
            tps: performance[0]?.numTransactions / performance[0]?.samplePeriodSecs || 0,
            version: version['solana-core'],
            isResponding: true,
            health: health ? 'healthy' : 'unhealthy',
            transactions: block.transactions.length,
            averageFee: block.transactions.reduce((acc, tx) => acc + (tx.meta?.fee || 0), 0) / block.transactions.length / 1e9 // Convert lamports to KOII
        };
    } catch (error) {
        console.error(`\n⚠️ Error checking node ${endpoint}:`, error.message);
        return {
            endpoint,
            blockHeight: 0,
            responseTime: -1,
            timestamp: 0,
            totalSupply: 0,
            circulatingSupply: 0,
            tps: 0,
            version: 'unknown',
            isResponding: false,
            health: 'offline',
            transactions: 0,
            averageFee: 0
        };
    }
}

function detectIssues(currentStatus, previousStatus) {
    const issues = [];
    
    if (currentStatus.responseTime > CONFIG.alertThresholds.responseTime) {
        issues.push(`⚠️ High response time: ${currentStatus.responseTime}ms`);
    }
    
    if (previousStatus && currentStatus.isResponding) {
        // Check if blocks are stalling
        if (currentStatus.blockHeight === previousStatus.blockHeight) {
            issues.push('⚠️ Blocks not advancing');
        }
        
        // Check for high transaction fees
        if (currentStatus.averageFee > CONFIG.alertThresholds.maxTransactionCost) {
            issues.push(`⚠️ High transaction fees: ${currentStatus.averageFee.toFixed(4)} KOII`);
        }
        
        // Check for unusual TPS drops
        if (previousStatus.tps > 0 && currentStatus.tps < previousStatus.tps * 0.5) {
            issues.push(`⚠️ TPS dropped by >50%: ${currentStatus.tps.toFixed(2)} TPS`);
        }
    }
    
    if (currentStatus.health !== 'healthy') {
        issues.push(`⚠️ Node health: ${currentStatus.health}`);
    }
    
    return issues;
}

function printStatusUpdate(results, previousResults) {
    console.clear(); // Clear console for clean update
    
    const summary = {
        timestamp: Date.now(),
        nodes: results,
        networkStats: {
            activeNodes: results.filter(r => r.isResponding).length,
            totalTps: results
                .filter(r => r.isResponding)
                .reduce((acc, curr) => acc + curr.tps, 0),
            averageFee: results
                .filter(r => r.isResponding)
                .reduce((acc, curr) => acc + curr.averageFee, 0) / 
                results.filter(r => r.isResponding).length || 0,
            highestBlock: Math.max(...results.map(r => r.blockHeight))
        }
    };

    console.log(`\n🔄 Koii K2 Network Monitor - ${new Date().toLocaleString()}`);
    console.log('==========================================');
    console.log(`🟢 Active Nodes: ${summary.networkStats.activeNodes}/${K2_NODES.length}`);
    console.log(`⚡ Total Network TPS: ${summary.networkStats.totalTps.toFixed(2)}`);
    console.log(`💰 Average Fee: ${summary.networkStats.averageFee.toFixed(6)} KOII`);
    console.log(`📦 Highest Block: ${summary.networkStats.highestBlock.toLocaleString()}\n`);
    
    console.log('📝 Node Status');
    console.log('============');
    results.forEach((node, index) => {
        const prev = previousResults ? previousResults[index] : null;
        const shortEndpoint = node.endpoint.replace('https://', '');
        
        console.log(`\n${node.isResponding ? '🟢' : '🔴'} ${shortEndpoint}`);
        if (node.isResponding) {
            // Show block height with change indicator
            const blockChange = prev && prev.isResponding 
                ? node.blockHeight - prev.blockHeight
                : 0;
            const blockIndicator = blockChange > 0 ? `(+${blockChange})` : blockChange < 0 ? `(${blockChange})` : '(no change)';
            console.log(`   Block: ${node.blockHeight.toLocaleString()} ${blockIndicator}`);
            
            // Show TPS with change indicator
            const tpsPrev = prev ? prev.tps : 0;
            const tpsChange = tpsPrev ? ((node.tps - tpsPrev) / tpsPrev * 100).toFixed(1) : 0;
            const tpsIndicator = tpsChange > 0 ? `(↑${tpsChange}%)` : tpsChange < 0 ? `(↓${Math.abs(tpsChange)}%)` : '';
            console.log(`   TPS: ${node.tps.toFixed(2)} ${tpsIndicator}`);
            
            console.log(`   Response: ${node.responseTime}ms`);
            console.log(`   Health: ${node.health}`);
            console.log(`   Version: ${node.version}`);
            console.log(`   Recent Transactions: ${node.transactions}`);
            console.log(`   Average Fee: ${node.averageFee.toFixed(6)} KOII`);
            
            // Show any detected issues
            const issues = detectIssues(node, prev);
            if (issues.length > 0) {
                console.log('   Issues:');
                issues.forEach(issue => console.log(`     ${issue}`));
            }
        } else {
            console.log('   Status: Offline');
        }
    });
    
    // Update previous results for next comparison
    previousCheck = results;
}

async function monitorNodes() {
    try {
        while (true) {
            const results = await Promise.all(K2_NODES.map(node => checkNodeStatus(node)));
            printStatusUpdate(results, previousCheck);
            await new Promise(resolve => setTimeout(resolve, CONFIG.checkInterval * 1000));
        }
    } catch (error) {
        console.error("\n❌ Error in monitoring:", error);
        process.exit(1);
    }
}

// Start monitoring with Ctrl+C handler
console.log('\n🚀 Starting Koii K2 Network Monitor...');
console.log('Press Ctrl+C to stop monitoring\n');

process.on('SIGINT', () => {
    console.log('\n\n👋 Stopping K2 Network Monitor...');
    process.exit(0);
});

monitorNodes().catch(console.error);
