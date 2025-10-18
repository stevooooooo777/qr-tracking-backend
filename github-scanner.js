// github-scanner.js
// Add this file to your Railway backend

class GitHubScanner {
  constructor(repoOwner, repoName, branch = 'main') {
    this.repoOwner = repoOwner;
    this.repoName = repoName;
    this.branch = branch;
    this.baseUrl = `https://raw.githubusercontent.com/${repoOwner}/${repoName}/${branch}`;
  }

  // Fetch file content from GitHub
  async fetchFile(filePath) {
    try {
      const url = `${this.baseUrl}/${filePath}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch ${filePath}: ${response.status}`);
      }
      
      return await response.text();
    } catch (error) {
      console.error(`Error fetching ${filePath}:`, error);
      return null;
    }
  }

  // Scan specific files
  async scanFrontendFiles(files) {
    const results = {
      scannedFiles: [],
      issues: [],
      apiCalls: []
    };

    for (const file of files) {
      console.log(`📄 Scanning ${file}...`);
      const content = await this.fetchFile(file);
      
      if (!content) {
        results.issues.push({
          type: 'file_not_found',
          severity: 'high',
          file,
          message: `Could not fetch ${file} from repository`
        });
        continue;
      }

      results.scannedFiles.push(file);

      // Analyze the file
      const fileAnalysis = this.analyzeFile(file, content);
      results.apiCalls.push(...fileAnalysis.apiCalls);
      results.issues.push(...fileAnalysis.issues);
    }

    return results;
  }

  // Analyze a single file for issues
  analyzeFile(filename, content) {
    const analysis = {
      apiCalls: [],
      issues: []
    };

    // Extract API calls
    const fetchRegex = /fetch\s*\(\s*`\$\{[^}]+\}([^`]+)`/g;
    let match;
    
    while ((match = fetchRegex.exec(content)) !== null) {
      const endpoint = match[1];
      
      // Find the response handling
      const contextStart = match.index;
      const context = content.slice(contextStart, contextStart + 1000);
      
      // Extract data access patterns
      const dataAccessRegex = /data\.([a-zA-Z_]+(?:\.[a-zA-Z_]+)*)/g;
      const accessedFields = new Set();
let fieldMatch;

while ((fieldMatch = dataAccessRegex.exec(context)) !== null) {
  accessedFields.add(fieldMatch[1]);  
}

      analysis.apiCalls.push({
        file: filename,
        endpoint,
        expectedFields: Array.from(accessedFields),
        lineNumber: this.getLineNumber(content, match.index)
      });
    }

    // Check for common issues
    
    // 1. Missing error handling
    if (content.includes('fetch(') && !content.includes('catch')) {
      analysis.issues.push({
        type: 'missing_error_handling',
        severity: 'medium',
        file: filename,
        message: 'API calls without error handling detected',
        suggestion: 'Add try-catch blocks or .catch() handlers to all fetch calls'
      });
    }

    // 2. Hardcoded API URLs
    const hardcodedUrlRegex = /fetch\s*\(\s*['"`](https?:\/\/[^'"`]+)['"`]/g;
    if (hardcodedUrlRegex.test(content)) {
      analysis.issues.push({
        type: 'hardcoded_url',
        severity: 'medium',
        file: filename,
        message: 'Hardcoded API URLs detected',
        suggestion: 'Use CONFIG.getApiBaseUrl() instead of hardcoded URLs'
      });
    }

    // 3. LocalStorage without checks
    if (content.includes('localStorage.getItem') && !content.includes('if (')) {
      const localStorageUse = content.match(/localStorage\.getItem\(['"]([^'"]+)['"]\)/g);
      if (localStorageUse) {
        analysis.issues.push({
          type: 'unsafe_localstorage',
          severity: 'low',
          file: filename,
          message: 'localStorage access without null checks detected',
          suggestion: 'Always check if localStorage values exist before using them'
        });
      }
    }

    // 4. Console.logs left in production
    const consoleCount = (content.match(/console\.log/g) || []).length;
    if (consoleCount > 5) {
      analysis.issues.push({
        type: 'excessive_logging',
        severity: 'low',
        file: filename,
        message: `${consoleCount} console.log statements found`,
        suggestion: 'Remove or comment out console.log statements before production'
      });
    }

    return analysis;
  }

  // Get line number for a character position
  getLineNumber(content, position) {
    return content.substring(0, position).split('\n').length;
  }

  // Compare frontend API calls with backend endpoints
  async compareWithBackend(frontendAPIs, backendContent) {
    const issues = [];
    
    // Extract backend endpoints
    const backendEndpoints = this.extractBackendEndpoints(backendContent);
    
    for (const frontendAPI of frontendAPIs) {
      // Find matching backend endpoint
      const backendMatch = backendEndpoints.find(be => 
        frontendAPI.endpoint.includes(be.path)
      );

      if (!backendMatch) {
        issues.push({
          type: 'missing_backend_endpoint',
          severity: 'high',
          file: frontendAPI.file,
          endpoint: frontendAPI.endpoint,
          line: frontendAPI.lineNumber,
          message: `Frontend calls ${frontendAPI.endpoint} but no matching backend route found`,
          category: 'API Consistency'
        });
        continue;
      }

      // Check field consistency
      for (const expectedField of frontendAPI.expectedFields) {
        const fieldParts = expectedField.split('.');
        const topLevel = fieldParts[0];
        
        if (!backendMatch.responseFields.includes(topLevel)) {
          // Try to find similar field
          const similar = backendMatch.responseFields.find(rf => 
            rf.toLowerCase().replace(/[_-]/g, '') === 
            topLevel.toLowerCase().replace(/[_-]/g, '')
          );

          issues.push({
            type: 'field_mismatch',
            severity: 'high',
            file: frontendAPI.file,
            endpoint: frontendAPI.endpoint,
            line: frontendAPI.lineNumber,
            expectedField,
            availableFields: backendMatch.responseFields,
            suggestion: similar ? 
              `Change '${expectedField}' to '${similar}' in ${frontendAPI.file}` :
              `Backend doesn't return '${expectedField}'. Available fields: ${backendMatch.responseFields.join(', ')}`,
            category: 'API Consistency',
            autoFixAvailable: !!similar,
            autoFix: similar ? {
              type: 'field_rename',
              oldField: expectedField,
              newField: similar,
              file: frontendAPI.file
            } : null
          });
        }
      }
    }

    return issues;
  }

  // Extract backend endpoints from server.js content
  extractBackendEndpoints(backendContent) {
    const endpoints = [];
    
    // Match Express routes: app.get('/api/...', ...)
    const routeRegex = /app\.(get|post|put|delete|patch)\s*\(['"`]([^'"`]+)['"`]/g;
    let match;
    
    while ((match = routeRegex.exec(backendContent)) !== null) {
      const method = match[1].toUpperCase();
      const path = match[2];
      
      // Find the response for this route
      const routeStart = match.index;
      const routeEnd = backendContent.indexOf('});', routeStart);
      const routeCode = backendContent.slice(routeStart, routeEnd);
      
      // Extract response fields
      const responseFields = this.extractResponseFields(routeCode);
      
      endpoints.push({
        method,
        path,
        responseFields
      });
    }
    
    return endpoints;
  }

  // Extract fields from res.json() calls
  extractResponseFields(code) {
    const fields = new Set();
    
    // Match res.json({ ... })
    const jsonRegex = /res\.json\s*\(\s*\{([^}]+)\}/g;
    let match;
    
    while ((match = jsonRegex.exec(code)) !== null) {
      const jsonBody = match[1];
      
      // Extract field names
      const fieldRegex = /(\w+):/g;
      let fieldMatch;
      
      while ((fieldMatch = fieldRegex.exec(jsonBody)) !== null) {
        fields.add(fieldMatch[1]);
      }
    }
    
    return Array.from(fields);
  }
}

module.exports = GitHubScanner;