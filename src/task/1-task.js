import { Connection } from '@solana/web3.js';

// K2 Network RPC endpoints
const K2_NODES = [
    'https://k2-mainnet.koii.live',
    'https://k2-testnet.koii.live',
];

// Scoring weights and thresholds
const SCORING = {
    weights: {
        responseTime: 0.2,    // 20% of score
        blockHeight: 0.25,    // 25% of score
        tps: 0.2,            // 20% of score
        health: 0.2,         // 20% of score
        peers: 0.15          // 15% of score
    },
    thresholds: {
        responseTime: {
            excellent: 1000,  // < 1s
            good: 2000,      // < 2s
            fair: 3000,      // < 3s
            poor: 5000       // < 5s
        },
        tps: {
            excellent: 50,    // > 50 TPS
            good: 30,        // > 30 TPS
            fair: 10,        // > 10 TPS
            poor: 1          // > 1 TPS
        },
        blockStall: 60,      // seconds
        minPeers: 3,
        maxTransactionCost: 0.1
    }
};

class NodeMetrics {
    constructor() {
        this.lastCheck = null;
    }

    async checkNodeStatus(endpoint) {
        const startTime = Date.now();
        try {
            const connection = new Connection(endpoint);
            
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
                averageFee: block.transactions.reduce((acc, tx) => acc + (tx.meta?.fee || 0), 0) / block.transactions.length / 1e9,
                peerCount: await connection.getClusterNodes().then(nodes => nodes.length)
            };
        } catch (error) {
            console.error(`Error checking node ${endpoint}:`, error.message);
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
                averageFee: 0,
                peerCount: 0
            };
        }
    }

    calculateMetricScore(metric, value) {
        switch (metric) {
            case 'responseTime':
                if (value < SCORING.thresholds.responseTime.excellent) return 100;
                if (value < SCORING.thresholds.responseTime.good) return 80;
                if (value < SCORING.thresholds.responseTime.fair) return 60;
                if (value < SCORING.thresholds.responseTime.poor) return 40;
                return 20;

            case 'tps':
                if (value > SCORING.thresholds.tps.excellent) return 100;
                if (value > SCORING.thresholds.tps.good) return 80;
                if (value > SCORING.thresholds.tps.fair) return 60;
                if (value > SCORING.thresholds.tps.poor) return 40;
                return 20;

            case 'health':
                return value === 'healthy' ? 100 : 0;

            case 'blockHeight':
                // Score based on how recent the block is compared to last check
                if (!this.lastCheck || !this.lastCheck.blockHeight) return 80;
                const blockDiff = value - this.lastCheck.blockHeight;
                if (blockDiff <= 0) return 40; // Stalled or went backwards
                if (blockDiff > 0 && blockDiff < 5) return 60; // Slow progress
                if (blockDiff >= 5 && blockDiff < 10) return 80; // Good progress
                return 100; // Excellent progress

            case 'peers':
                if (value >= SCORING.thresholds.minPeers * 2) return 100;
                if (value >= SCORING.thresholds.minPeers) return 80;
                if (value >= SCORING.thresholds.minPeers / 2) return 50;
                return 20;

            default:
                return 0;
        }
    }

    validateMetrics(metrics) {
        const scores = {
            responseTime: this.calculateMetricScore('responseTime', metrics.responseTime),
            blockHeight: this.calculateMetricScore('blockHeight', metrics.blockHeight),
            tps: this.calculateMetricScore('tps', metrics.tps),
            health: this.calculateMetricScore('health', metrics.health),
            peers: this.calculateMetricScore('peers', metrics.peerCount)
        };

        // Calculate weighted score
        const weightedScore = Object.entries(scores).reduce((total, [metric, score]) => {
            return total + (score * SCORING.weights[metric]);
        }, 0);

        // Generate detailed report
        const report = {
            scores,
            weightedScore,
            details: {
                responseTime: `${metrics.responseTime}ms (${scores.responseTime}%)`,
                blockHeight: `${metrics.blockHeight} (${scores.blockHeight}%)`,
                tps: `${metrics.tps.toFixed(2)} TPS (${scores.tps}%)`,
                health: `${metrics.health} (${scores.health}%)`,
                peers: `${metrics.peerCount} peers (${scores.peers}%)`
            },
            issues: []
        };

        // Add specific issues based on scores
        if (scores.responseTime < 60) report.issues.push(`High response time: ${metrics.responseTime}ms`);
        if (scores.blockHeight < 60) report.issues.push('Block height not advancing normally');
        if (scores.tps < 60) report.issues.push(`Low TPS: ${metrics.tps.toFixed(2)}`);
        if (scores.health < 100) report.issues.push('Node health issues detected');
        if (scores.peers < 60) report.issues.push(`Low peer count: ${metrics.peerCount}`);

        return {
            ...metrics,
            report,
            score: Math.round(weightedScore)
        };
    }
}

class Task {
    constructor(namespaceWrapper) {
        this.namespace = namespaceWrapper;
        this.nodeMetrics = new NodeMetrics();
    }

    async task(round) {
        try {
            console.log('Starting K2 node monitoring task for round:', round);
            
            // Check all nodes in parallel
            const nodePromises = K2_NODES.map(endpoint => 
                this.nodeMetrics.checkNodeStatus(endpoint)
            );
            
            const results = await Promise.all(nodePromises);
            
            // Validate and score each node's metrics
            const validatedResults = results.map(metrics => 
                this.nodeMetrics.validateMetrics(metrics)
            );
            
            // Calculate network health score (0-100)
            const networkScore = validatedResults.reduce((acc, node) => 
                acc + node.score, 0) / validatedResults.length;
            
            // Prepare submission data
            const submissionData = {
                timestamp: Date.now(),
                round,
                networkScore,
                nodes: validatedResults.map(node => ({
                    endpoint: node.endpoint,
                    score: node.score,
                    issues: node.issues,
                    metrics: {
                        blockHeight: node.blockHeight,
                        tps: node.tps,
                        health: node.health,
                        responseTime: node.responseTime
                    }
                }))
            };

            // Store results in namespace
            await this.namespace.submitTask(submissionData);
            
            console.log(`Round ${round} completed. Network Score: ${networkScore.toFixed(2)}`);
            
            // Update last check for next round
            this.nodeMetrics.lastCheck = results[0];
            
            return submissionData;
            
        } catch (error) {
            console.error('Error in monitoring task:', error);
            throw error;
        }
    }
}

export default Task;
