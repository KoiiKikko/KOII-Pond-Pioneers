import { namespaceWrapper } from "@_koii/namespace-wrapper";

export async function submission(roundNumber: number): Promise<boolean> {
  try {
    // Get stored results
    const results = await namespaceWrapper.storeGet(`node_status_${roundNumber}`);
    
    if (!results) {
      console.error('No results found for submission');
      return false;
    }

    // Submit results to the network
    await namespaceWrapper.submitTask({
      roundNumber: roundNumber,
      taskOutput: results,
    });

    console.log('Successfully submitted results for round', roundNumber);
    return true;
  } catch (error) {
    console.error('Error in submission:', error);
    return false;
  }
}
