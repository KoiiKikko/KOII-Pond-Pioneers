class Submission {
    constructor(namespaceWrapper) {
        this.namespace = namespaceWrapper;
    }

    async validateNode(nodeData) {
        // Basic validation checks
        if (!nodeData || typeof nodeData !== 'object') return false;
        if (!nodeData.metrics || typeof nodeData.metrics !== 'object') return false;
        
        // Validate required fields
        const requiredMetrics = ['blockHeight', 'tps', 'health', 'responseTime'];
        if (!requiredMetrics.every(metric => metric in nodeData.metrics)) return false;
        
        // Validate data types and ranges
        if (typeof nodeData.metrics.blockHeight !== 'number' || nodeData.metrics.blockHeight < 0) return false;
        if (typeof nodeData.metrics.tps !== 'number' || nodeData.metrics.tps < 0) return false;
        if (typeof nodeData.metrics.responseTime !== 'number' || nodeData.metrics.responseTime < 0) return false;
        if (typeof nodeData.metrics.health !== 'string') return false;
        
        return true;
    }

    async validateSubmission(submissionData) {
        try {
            // Check if submission exists
            if (!submissionData) return false;
            
            // Validate submission structure
            if (!submissionData.timestamp || !submissionData.round || !Array.isArray(submissionData.nodes)) {
                return false;
            }
            
            // Validate each node's data
            for (const node of submissionData.nodes) {
                if (!await this.validateNode(node)) {
                    return false;
                }
            }
            
            // Validate network score
            if (typeof submissionData.networkScore !== 'number' || 
                submissionData.networkScore < 0 || 
                submissionData.networkScore > 100) {
                return false;
            }
            
            // Validate timestamp is recent (within last hour)
            const now = Date.now();
            if (submissionData.timestamp < now - 3600000 || submissionData.timestamp > now) {
                return false;
            }
            
            return true;
        } catch (error) {
            console.error('Error validating submission:', error);
            return false;
        }
    }

    async submitTask(roundNumber) {
        try {
            // Get stored results from the round
            const submissionData = await this.namespace.getTaskSubmission(roundNumber);
            
            if (!submissionData) {
                throw new Error('No submission data found for round ' + roundNumber);
            }
            
            // Validate submission before submitting
            const isValid = await this.validateSubmission(submissionData);
            
            if (!isValid) {
                throw new Error('Submission validation failed');
            }
            
            return submissionData;
            
        } catch (error) {
            console.error('Error in submission:', error);
            throw error;
        }
    }
}

export default Submission;
