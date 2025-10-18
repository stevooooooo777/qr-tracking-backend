// claude-analyzer.js
// AI-powered code analysis using Claude API

class ClaudeAnalyzer {
  constructor() {
    this.apiUrl = 'https://api.anthropic.com/v1/messages';
    this.model = 'claude-sonnet-4-20250514';
    this.apiKey = process.env.ANTHROPIC_API_KEY;
    
    if (!this.apiKey) {
      console.error('❌ ANTHROPIC_API_KEY not set!');
    } else {
      console.log('✅ Claude API key loaded');
    }
  }

  // Analyze code issues with AI
  async analyzeIssues(issues, codeContext) {
    console.log('🤖 Claude analyzing', issues.length, 'issues...');
    
    if (issues.length === 0) {
      return [];
    }

    const prompt = this.buildAnalysisPrompt(issues, codeContext);
    
    try {
 const response = await fetch(this.apiUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': this.apiKey,
    'anthropic-version': '2023-06-01'
  },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: prompt
          }]
        })
      });

      if (!response.ok) {
        throw new Error(`Claude API error: ${response.status}`);
      }

      const data = await response.json();
      const analysis = data.content[0].text;

      // Parse Claude's response
      return this.parseClaudeResponse(analysis, issues);
    } catch (error) {
      console.error('Claude analysis error:', error);
      return issues; // Return original issues if AI fails
    }
  }

  // Build a prompt for Claude
  buildAnalysisPrompt(issues, codeContext) {
    const issuesSummary = issues.map((issue, i) => 
      `${i + 1}. [${issue.severity}] ${issue.type}: ${issue.message}\n   File: ${issue.file}\n   ${issue.endpoint ? `Endpoint: ${issue.endpoint}` : ''}`
    ).join('\n\n');

    return `You are a senior code reviewer analyzing a Node.js/React web application. The codebase uses:
- Frontend: HTML/JavaScript on Netlify
- Backend: Node.js/Express/PostgreSQL on Railway
- Authentication: JWT + bcrypt
- API: RESTful endpoints

I've detected these issues in the codebase:

${issuesSummary}

${codeContext ? `\nCode context:\n${codeContext}` : ''}

For each issue, provide:
1. Impact assessment (how critical is this?)
2. Root cause explanation
3. Specific fix recommendation
4. Code example if applicable

Respond in JSON format:
{
  "analyses": [
    {
      "issueNumber": 1,
      "impact": "description of impact",
      "rootCause": "why this happened",
      "recommendation": "how to fix it",
      "priority": "critical|high|medium|low",
      "codeExample": "optional code snippet"
    }
  ]
}

Focus on practical, actionable advice. Be concise but thorough.`;
  }

  // Parse Claude's JSON response
  parseClaudeResponse(responseText, originalIssues) {
    try {
      // Claude might wrap JSON in markdown code blocks
      const jsonMatch = responseText.match(/```json\n?([\s\S]+?)\n?```/) || 
                       responseText.match(/\{[\s\S]+\}/);
      
      if (!jsonMatch) {
        console.warn('Could not extract JSON from Claude response');
        return originalIssues;
      }

      const jsonText = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonText);

      // Enhance original issues with Claude's analysis
      return originalIssues.map((issue, i) => {
        const analysis = parsed.analyses?.find(a => a.issueNumber === i + 1);
        
        if (analysis) {
          return {
            ...issue,
            aiAnalysis: {
              impact: analysis.impact,
              rootCause: analysis.rootCause,
              recommendation: analysis.recommendation,
              priority: analysis.priority,
              codeExample: analysis.codeExample
            }
          };
        }
        
        return issue;
      });
    } catch (error) {
      console.error('Error parsing Claude response:', error);
      return originalIssues;
    }
  }

  // Analyze code architecture
  async analyzeArchitecture(frontendFiles, backendFile) {
    console.log('🏗️ Claude analyzing architecture...');

    const prompt = `Analyze this web application architecture:

FRONTEND FILES:
${frontendFiles.slice(0, 3).map(f => `- ${f.name}`).join('\n')}

BACKEND:
- Node.js/Express on Railway
- PostgreSQL database
- JWT authentication

Provide a brief architecture assessment covering:
1. Overall structure quality (score 1-10)
2. Top 3 architectural concerns
3. Top 3 improvements to make
4. Security assessment

Respond in JSON:
{
  "score": 7,
  "concerns": ["concern 1", "concern 2", "concern 3"],
  "improvements": ["improvement 1", "improvement 2", "improvement 3"],
  "security": "brief security assessment"
}`;

    try {
const response = await fetch(this.apiUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': this.apiKey,
    'anthropic-version': '2023-06-01'
  },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1000,
          messages: [{
            role: 'user',
            content: prompt
          }]
        })
      });

      if (!response.ok) {
        throw new Error(`Claude API error: ${response.status}`);
      }

      const data = await response.json();
      const analysis = data.content[0].text;

      // Parse response
      const jsonMatch = analysis.match(/```json\n?([\s\S]+?)\n?```/) || 
                       analysis.match(/\{[\s\S]+\}/);
      
      if (jsonMatch) {
        const jsonText = jsonMatch[1] || jsonMatch[0];
        return JSON.parse(jsonText);
      }

      return null;
    } catch (error) {
      console.error('Architecture analysis error:', error);
      return null;
    }
  }

  // Generate auto-fix code
  async generateAutoFix(issue) {
    console.log('🔧 Claude generating auto-fix for:', issue.type);

    const prompt = `Generate a code fix for this issue:

ISSUE: ${issue.message}
FILE: ${issue.file}
TYPE: ${issue.type}
${issue.endpoint ? `ENDPOINT: ${issue.endpoint}` : ''}
${issue.expectedField ? `EXPECTED FIELD: ${issue.expectedField}` : ''}
${issue.availableFields ? `AVAILABLE FIELDS: ${issue.availableFields.join(', ')}` : ''}

Provide the exact code change needed to fix this issue.

Respond in JSON:
{
  "fixType": "find_and_replace|insert|delete",
  "file": "${issue.file}",
  "findText": "code to find (exact match)",
  "replaceText": "code to replace with",
  "explanation": "brief explanation of the fix"
}

Be precise with the code - it will be applied automatically.`;

    try {
const response = await fetch(this.apiUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': this.apiKey,
    'anthropic-version': '2023-06-01'
  },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1000,
          messages: [{
            role: 'user',
            content: prompt
          }]
        })
      });

      if (!response.ok) {
        throw new Error(`Claude API error: ${response.status}`);
      }

      const data = await response.json();
      const fixCode = data.content[0].text;

      // Parse response
      const jsonMatch = fixCode.match(/```json\n?([\s\S]+?)\n?```/) || 
                       fixCode.match(/\{[\s\S]+\}/);
      
      if (jsonMatch) {
        const jsonText = jsonMatch[1] || jsonMatch[0];
        return JSON.parse(jsonText);
      }

      return null;
    } catch (error) {
      console.error('Auto-fix generation error:', error);
      return null;
    }
  }
}

module.exports = ClaudeAnalyzer;