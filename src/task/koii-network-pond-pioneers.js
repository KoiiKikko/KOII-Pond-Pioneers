const { Connection, clusterApiUrl } = require('@solana/web3.js');
const fetch = require('node-fetch');

// Configuration
const CONFIG = {
    checkInterval: 15, // seconds between checks (reduced from 30)
    alertThresholds: {
        responseTime: 5000, // ms
        blockStall: 60,    // seconds
        minPeers: 2,
        maxFee: 100        // KOII
    }
};

// K2 Network RPC endpoints
const K2_NODES = [
    // Main K2 endpoints
    'https://k2.koii.live',
    'https://k2-main.koii.live',
    'https://k2-mainnet.koii.network',
    
    // Testnet endpoints
    'https://k2-testnet.koii.live',
    'https://k2-testnet.koii.network',
    
    // Development endpoints
    'https://k2-devnet.koii.live',
    'https://k2-dev.koii.network',
    
    // Community nodes (these are example URLs, replace with actual community node URLs)
    'https://k2-community-1.koii.live',
    'https://k2-community-2.koii.live',
    
    // Backup endpoints
    'https://k2-backup.koii.live',
    'https://k2-fallback.koii.network'
];

// Function to filter active nodes based on network type
function getNodesForNetwork(networkType) {
    const nodeMap = {
        'mainnet': K2_NODES.filter(n => n.includes('main') || !n.includes('test') && !n.includes('dev')),
        'testnet': K2_NODES.filter(n => n.includes('test')),
        'devnet': K2_NODES.filter(n => n.includes('dev'))
    };
    return nodeMap[networkType] || K2_NODES;
}

async function checkNodeStatus(endpoint) {
    const startTime = Date.now();
    try {
        // First check if the node is responding to basic requests
        const healthCheck = await fetch(`${endpoint}/health`).then(res => res.ok).catch(() => false);
        if (!healthCheck) {
            throw new Error('Node health check failed');
        }

        const connection = new Connection(endpoint, 'confirmed');
        
        // Enhanced node information collection
        const [
            slot,
            epoch,
            blockTime,
            supply,
            inflation,
            recentPerf,
            version,
            clusterNodes,
            blockProduction,
            voteAccounts
        ] = await Promise.all([
            connection.getSlot().catch(() => null),
            connection.getEpochInfo().catch(() => null),
            connection.getBlockTime(await connection.getSlot()).catch(() => null),
            connection.getSupply().catch(() => null),
            connection.getInflationRate().catch(() => null),
            connection.getRecentPerformanceSamples(1).catch(() => []),
            connection.getVersion().catch(() => null),
            connection.getClusterNodes().catch(() => []),
            connection.getBlockProduction().catch(() => null),
            connection.getVoteAccounts().catch(() => null)
        ]);

        // Calculate detailed metrics
        const perfSample = recentPerf[0] || {};
        const tps = perfSample.numTransactions / (perfSample.samplePeriodSecs || 1);
        const blockProductionStats = blockProduction?.value || {};
        const leaderSlots = blockProductionStats.byIdentity || {};
        
        // Get node version info
        const nodeVersion = version?.['solana-core'] || 'unknown';
        const featureSet = version?.['feature-set'] || 'unknown';
        
        // Calculate vote statistics
        const totalStake = voteAccounts?.current?.reduce((acc, v) => acc + (v.activatedStake || 0), 0) || 0;
        const activeValidators = voteAccounts?.current?.length || 0;
        const delinquentValidators = voteAccounts?.delinquent?.length || 0;

        return {
            endpoint,
            isResponding: true,
            timestamp: Date.now(),
            responseTime: Date.now() - startTime,
            
            // Basic node info
            slot,
            epoch: epoch?.epoch,
            blockTime,
            version: {
                core: nodeVersion,
                featureSet
            },
            
            // Network stats
            tps,
            supply: {
                total: supply?.value?.total || 0,
                circulating: supply?.value?.circulating || 0,
                nonCirculating: supply?.value?.nonCirculating || 0
            },
            inflation: {
                total: inflation?.total || 0,
                validator: inflation?.validator || 0,
                foundation: inflation?.foundation || 0,
                epoch: epoch?.absoluteSlot || 0
            },
            
            // Cluster info
            cluster: {
                nodes: clusterNodes.length,
                activeValidators,
                delinquentValidators,
                totalStake: totalStake / 1e9, // Convert to SOL
                nodeTypes: {
                    validators: clusterNodes.filter(n => n.pubkey).length,
                    rpc: clusterNodes.filter(n => !n.pubkey).length
                }
            },
            
            // Performance metrics
            performance: {
                tps,
                shortTps: perfSample.numTransactions / (perfSample.samplePeriodSecs || 1),
                maxTps: perfSample.maxTransactionsPerSecond || 0,
                txCount: perfSample.numTransactions || 0,
                failedTx: perfSample.numFailedTransactions || 0,
                successRate: perfSample.numTransactions ? 
                    ((perfSample.numTransactions - (perfSample.numFailedTransactions || 0)) / perfSample.numTransactions * 100).toFixed(2) : 0
            },
            
            // Health status
            status: {
                slot: !!slot,
                epoch: !!epoch,
                blockTime: !!blockTime,
                supply: !!supply,
                validators: !!voteAccounts,
                performance: !!recentPerf.length
            }
        };
    } catch (error) {
        console.error(`\n⚠️ Error checking node ${endpoint}:`, error.message);
        return {
            endpoint,
            isResponding: false,
            timestamp: Date.now(),
            responseTime: Date.now() - startTime,
            error: error.message
        };
    }
}

async function detectIssues(currentStatus, previousStatus) {
    const issues = [];
    
    if (currentStatus.responseTime > CONFIG.alertThresholds.responseTime) {
        issues.push(`⚠️ High response time: ${currentStatus.responseTime}ms`);
    }
    
    if (previousStatus && currentStatus.isResponding) {
        // Check if blocks are stalling
        if (currentStatus.slot === previousStatus.slot) {
            issues.push('⚠️ Blocks not advancing');
        }
        
        // Check for sudden peer count drops
        // if (currentStatus.peerCount < CONFIG.alertThresholds.minPeers) {
        //     issues.push(`⚠️ Low peer count: ${currentStatus.peerCount}`);
        // }
        
        // Check for fee spikes
        // if (parseFloat(currentStatus.averageFee) > CONFIG.alertThresholds.maxFee) {
        //     issues.push(`⚠️ High average fee: ${currentStatus.averageFee} KOII`);
        // }
    }
    
    return issues;
}

async function printStatusUpdate(results, previousResults) {
    console.clear(); // Clear console for clean update
    
    const summary = {
        timestamp: Date.now(),
        nodes: results,
        networkStats: {
            activeNodes: results.filter(r => r.isResponding).length,
            totalTps: results
                .filter(r => r.isResponding)
                .reduce((acc, curr) => acc + curr.tps, 0),
            // averageFee: results
            //     .filter(r => r.isResponding)
            //     .reduce((acc, curr) => acc + curr.averageFee, 0) / 
            //     results.filter(r => r.isResponding).length || 0,
        }
    };

    console.log(`\n🔄 Koii K2 Node Monitor - ${new Date().toLocaleString()}`);
    console.log('=====================================');
    console.log(`🟢 Active Nodes: ${summary.networkStats.activeNodes}/${K2_NODES.length}`);
    console.log(`⚡ Total Network TPS: ${summary.networkStats.totalTps.toFixed(2)}`);
    // console.log(`💰 Average Fee: ${summary.networkStats.averageFee.toFixed(6)} KOII`);
    console.log('\n');
    
    console.log('📝 Node Status');
    console.log('============');
    results.forEach((node, index) => {
        const prev = previousResults ? previousResults[index] : null;
        const shortEndpoint = node.endpoint.replace('https://', '');
        
        console.log(`\n${node.isResponding ? '🟢' : '🔴'} ${shortEndpoint}`);
        
        if (node.isResponding) {
            // Basic Info
            console.log('\n   📊 Basic Information:');
            console.log(`   • Slot: ${node.slot?.toLocaleString() || 'N/A'}`);
            console.log(`   • Epoch: ${node.epoch || 'N/A'}`);
            console.log(`   • Version: ${node.version.core} (Feature Set: ${node.version.featureSet})`);
            console.log(`   • Response Time: ${node.responseTime}ms`);
            console.log(`   • Last Block: ${node.blockTime ? new Date(node.blockTime * 1000).toLocaleString() : 'N/A'}`);
            
            // Network Stats
            console.log('\n   🌐 Network Statistics:');
            console.log(`   • Total Supply: ${(node.supply.total / 1e9).toFixed(2)} KOII`);
            console.log(`   • Circulating: ${(node.supply.circulating / 1e9).toFixed(2)} KOII`);
            console.log(`   • Inflation Rate: ${(node.inflation.total * 100).toFixed(2)}%`);
            
            // Cluster Info
            console.log('\n   👥 Cluster Information:');
            console.log(`   • Total Nodes: ${node.cluster.nodes}`);
            console.log(`   • Validators: ${node.cluster.nodeTypes.validators}`);
            console.log(`   • RPC Nodes: ${node.cluster.nodeTypes.rpc}`);
            console.log(`   • Active Validators: ${node.cluster.activeValidators}`);
            console.log(`   • Delinquent: ${node.cluster.delinquentValidators}`);
            console.log(`   • Total Stake: ${node.cluster.totalStake.toFixed(2)} KOII`);
            
            // Performance
            console.log('\n   ⚡ Performance Metrics:');
            console.log(`   • Current TPS: ${node.performance.tps.toFixed(2)}`);
            console.log(`   • Max TPS: ${node.performance.maxTps.toFixed(2)}`);
            console.log(`   • Transaction Count: ${node.performance.txCount.toLocaleString()}`);
            console.log(`   • Failed Transactions: ${node.performance.failedTx.toLocaleString()}`);
            console.log(`   • Success Rate: ${node.performance.successRate}%`);
            
            // Health Status
            console.log('\n   🏥 Health Status:');
            console.log(`   • Slot Info: ${node.status.slot ? '✅' : '❌'}`);
            console.log(`   • Epoch Info: ${node.status.epoch ? '✅' : '❌'}`);
            console.log(`   • Block Time: ${node.status.blockTime ? '✅' : '❌'}`);
            console.log(`   • Supply Info: ${node.status.supply ? '✅' : '❌'}`);
            console.log(`   • Validator Info: ${node.status.validators ? '✅' : '❌'}`);
            console.log(`   • Performance Data: ${node.status.performance ? '✅' : '❌'}`);
            
            // Show any detected issues
            const issues = detectIssues(node, prev);
            if (issues.length > 0) {
                console.log('   Issues:');
                issues.forEach(issue => console.log(`     ${issue}`));
            }
        } else {
            console.log(`   ❌ Status: Offline`);
            if (node.error) {
                console.log(`   ⚠️ Error: ${node.error}`);
            }
        }
        console.log('\n   ' + '─'.repeat(50));
    });
    
    // Update previous results for next comparison
    previousCheck = results;
}

async function main() {
    try {
        console.log('\n🔍 Starting Koii K2 Node Status Check...\n');
        
        // Get nodes for each network type
        const mainnetNodes = getNodesForNetwork('mainnet');
        const testnetNodes = getNodesForNetwork('testnet');
        const devnetNodes = getNodesForNetwork('devnet');
        
        // Check all nodes in parallel
        const allPromises = [
            ...mainnetNodes.map(node => checkNodeStatus(node).then(result => ({...result, network: 'mainnet'}))),
            ...testnetNodes.map(node => checkNodeStatus(node).then(result => ({...result, network: 'testnet'}))),
            ...devnetNodes.map(node => checkNodeStatus(node).then(result => ({...result, network: 'devnet'}))),
        ];
        
        const results = await Promise.all(allPromises);
        
        // Group results by network
        const networkResults = {
            mainnet: results.filter(r => r.network === 'mainnet'),
            testnet: results.filter(r => r.network === 'testnet'),
            devnet: results.filter(r => r.network === 'devnet')
        };
        
        // Print summary for each network
        for (const [network, nodes] of Object.entries(networkResults)) {
            const activeNodes = nodes.filter(r => r.isResponding);
            const avgResponseTime = activeNodes.reduce((acc, node) => acc + node.responseTime, 0) / activeNodes.length || 0;
            const totalTps = activeNodes.reduce((acc, node) => acc + node.tps, 0);
            
            console.log(`\n📊 K2 ${network.toUpperCase()} Summary`);
            console.log('============================');
            console.log(`🟢 Active Nodes: ${activeNodes.length}/${nodes.length}`);
            console.log(`⚡ Total Network TPS: ${totalTps.toFixed(2)}`);
            console.log(`⏱️ Average Response Time: ${avgResponseTime.toFixed(0)}ms`);
            
            // Print individual node status
            console.log('\n📝 Node Status');
            console.log('============');
            nodes.forEach(node => {
                const shortEndpoint = node.endpoint.replace('https://', '');
                console.log(`\n${node.isResponding ? '🟢' : '🔴'} ${shortEndpoint}`);
                
                if (node.isResponding) {
                    // Basic Info
                    console.log('\n   📊 Basic Information:');
                    console.log(`   • Slot: ${node.slot?.toLocaleString() || 'N/A'}`);
                    console.log(`   • Epoch: ${node.epoch || 'N/A'}`);
                    console.log(`   • Version: ${node.version.core} (Feature Set: ${node.version.featureSet})`);
                    console.log(`   • Response Time: ${node.responseTime}ms`);
                    console.log(`   • Last Block: ${node.blockTime ? new Date(node.blockTime * 1000).toLocaleString() : 'N/A'}`);
                    
                    // Network Stats
                    console.log('\n   🌐 Network Statistics:');
                    console.log(`   • Total Supply: ${(node.supply.total / 1e9).toFixed(2)} KOII`);
                    console.log(`   • Circulating: ${(node.supply.circulating / 1e9).toFixed(2)} KOII`);
                    console.log(`   • Inflation Rate: ${(node.inflation.total * 100).toFixed(2)}%`);
                    
                    // Cluster Info
                    console.log('\n   👥 Cluster Information:');
                    console.log(`   • Total Nodes: ${node.cluster.nodes}`);
                    console.log(`   • Validators: ${node.cluster.nodeTypes.validators}`);
                    console.log(`   • RPC Nodes: ${node.cluster.nodeTypes.rpc}`);
                    console.log(`   • Active Validators: ${node.cluster.activeValidators}`);
                    console.log(`   • Delinquent: ${node.cluster.delinquentValidators}`);
                    console.log(`   • Total Stake: ${node.cluster.totalStake.toFixed(2)} KOII`);
                    
                    // Performance
                    console.log('\n   ⚡ Performance Metrics:');
                    console.log(`   • Current TPS: ${node.performance.tps.toFixed(2)}`);
                    console.log(`   • Max TPS: ${node.performance.maxTps.toFixed(2)}`);
                    console.log(`   • Transaction Count: ${node.performance.txCount.toLocaleString()}`);
                    console.log(`   • Failed Transactions: ${node.performance.failedTx.toLocaleString()}`);
                    console.log(`   • Success Rate: ${node.performance.successRate}%`);
                } else {
                    console.log('   Status: Offline');
                }
            });
        }
        
        console.log(`\n⏰ Next update in ${CONFIG.checkInterval} seconds...\n`);
        
    } catch (error) {
        console.error("\n❌ Error executing task:", error);
        throw error;
    }
}

// Store previous check results for comparison
let previousCheck = null;

// Run the monitor every 15 seconds
async function monitor() {
    while (true) {
        await main();
        await new Promise(resolve => setTimeout(resolve, CONFIG.checkInterval * 1000));
    }
}

console.log('\n🚀 Starting Koii K2 Monitor...');
console.log('Press Ctrl+C to stop monitoring\n');

process.on('SIGINT', () => {
    console.log('\n\n👋 Stopping K2 Monitor...');
    process.exit(0);
});

monitor().catch(console.error);
