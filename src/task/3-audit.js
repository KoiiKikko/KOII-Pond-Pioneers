class Audit {
    constructor(namespaceWrapper) {
        this.namespace = namespaceWrapper;
    }

    async validateNodeData(nodeData, otherSubmissions) {
        // Get all reported metrics for this node
        const nodeMetrics = otherSubmissions.map(sub => 
            sub.nodes.find(n => n.endpoint === nodeData.endpoint)
        ).filter(Boolean);
        
        if (nodeMetrics.length === 0) return false;
        
        // Calculate median values
        const medianBlockHeight = this.getMedian(nodeMetrics.map(n => n.metrics.blockHeight));
        const medianTps = this.getMedian(nodeMetrics.map(n => n.metrics.tps));
        
        // Check if this node's values are within acceptable range of median
        const blockHeightDiff = Math.abs(nodeData.metrics.blockHeight - medianBlockHeight);
        const tpsDiff = Math.abs(nodeData.metrics.tps - medianTps);
        
        // Allow 5% deviation from median
        const blockHeightValid = blockHeightDiff <= medianBlockHeight * 0.05;
        const tpsValid = tpsDiff <= Math.max(medianTps * 0.05, 1); // At least 1 TPS difference allowed
        
        return blockHeightValid && tpsValid;
    }

    getMedian(numbers) {
        const sorted = numbers.slice().sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        
        if (sorted.length % 2 === 0) {
            return (sorted[middle - 1] + sorted[middle]) / 2;
        }
        
        return sorted[middle];
    }

    async audit(submissionValues, round) {
        try {
            // Validate each submission
            const validSubmissions = [];
            
            for (const submission of submissionValues) {
                // Basic structure validation
                if (!submission || !submission.nodes || !Array.isArray(submission.nodes)) {
                    continue;
                }
                
                // Timestamp validation (must be within round window)
                const roundTime = await this.namespace.getRoundTime();
                if (submission.timestamp < round * roundTime || 
                    submission.timestamp > (round + 1) * roundTime) {
                    continue;
                }
                
                validSubmissions.push(submission);
            }
            
            if (validSubmissions.length === 0) {
                throw new Error('No valid submissions found');
            }
            
            // Validate each node's data against other submissions
            const validatedSubmissions = validSubmissions.map(submission => {
                const validNodes = submission.nodes.filter(node => 
                    this.validateNodeData(node, validSubmissions.filter(s => s !== submission))
                );
                
                return {
                    ...submission,
                    validNodeCount: validNodes.length,
                    totalNodes: submission.nodes.length
                };
            });
            
            // Calculate submission scores (0-100)
            const scoredSubmissions = validatedSubmissions.map(submission => ({
                submitter: submission.submitter,
                score: (submission.validNodeCount / submission.totalNodes) * 100
            }));
            
            // Return scores for distribution
            return scoredSubmissions;
            
        } catch (error) {
            console.error('Error in audit:', error);
            throw error;
        }
    }
}

export default Audit;
