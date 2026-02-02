// Minimal Inquirer stub used in tests.
export interface InquirerLike {
  prompt<TAnswers = any>(questions: any): Promise<TAnswers>;
}

/**
 * Builds an Inquirer-like object that always returns the provided answers.
 */
export function createInquirerStub(answers: any): InquirerLike {
  return {
    async prompt() {
      return answers;
    },
  };
}
