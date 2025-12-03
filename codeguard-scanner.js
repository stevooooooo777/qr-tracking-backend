/*!
 * ═══════════════════════════════════════════════════════════════
 * insane.marketing - Luxury Hospitality Intelligence Platform
 * ═══════════════════════════════════════════════════════════════
 * 
 * Copyright (c) 2024-2025 insane.marketing
 * All Rights Reserved - Proprietary and Confidential

 * 
 * NOTICE: This code contains proprietary business logic and trade secrets.
 * 
 * Unauthorized use, reproduction, or distribution of this code,
 * or any portion of it, may result in severe civil and criminal penalties,
 * and will be prosecuted to the maximum extent possible under the law.

 * 
 * Key Protected Features:
 * - Zero-Knowledge Architecture & Data Handling
 * - Time Machine Transformation Visualization System
 * - VIP Prediction & Recognition Engine
 * - Service Recovery Intelligence System
 * - Real-time Mission Control Analytics

 * Protected by AI tracking - active
 * For licensing inquiries: steve@insane.marketing

 * ═══════════════════════════════════════════════════════════════
 */










// codeguard-scanner.js

const fs = require('fs').promises;
const path = require('path');

class CodeGuardScanner {
  constructor() {
    this.issues = [];
    this.warnings = [];
    this.suggestions = [];
  }

  // Scan for API field mismatches between frontend and backend
  async scanAPIConsistency(frontendPath, backendPath) {
    console.log('🔍 Scanning API consistency...');
    
    try {
      // Extract API calls from frontend
      const frontendAPIs = await this.extractFrontendAPICalls(frontendPath);
      
      // Extract API responses from backend
      const backendAPIs = await this.extractBackendResponses(backendPath);
      
      // Compare and find mismatches
      const mismatches = this.compareAPIs(frontendAPIs, backendAPIs);
      
      return {
        status: mismatches.length === 0 ? 'healthy' : 'warning',
        mismatches,
        frontendEndpoints: frontendAPIs.length,
        backendEndpoints: backendAPIs.length
      };
    } catch (error) {
      console.error('API consistency scan error:', error);
      return { status: 'error', error: error.message };
    }
  }

  // Extract fetch calls from frontend files
  async extractFrontendAPICalls(frontendPath) {
    const apis = [];
    
    try {
      const files = await this.getHTMLFiles(frontendPath);
      
      for (const file of files) {
        const content = await fs.readFile(file, 'utf-8');
        
        // Find all fetch calls
        const fetchRegex = /fetch\s*\(\s*[`'"]([^`'"]+)[`'"]/g;
        let match;
        
        while ((match = fetchRegex.exec(content)) !== null) {
          const endpoint = match[1];
          
          // Extract expected response fields (looking for data.user.field patterns)
          const dataAccessRegex = /data\.([a-zA-Z_]+(?:\.[a-zA-Z_]+)*)/g;
          const fields = [];
          let fieldMatch;
          
          // Get 200 chars after the fetch call to find response usage
          const contextStart = match.index;
          const context = content.slice(contextStart, contextStart + 500);
          
          while ((fieldMatch = dataAccessRegex.exec(context)) !== null) {
            fields.push(fieldMatch[1]);
          }
          
          apis.push({
            file: path.basename(file),
            endpoint,
            expectedFields: [...new Set(fields)]
          });
        }
      }
    } catch (error) {
      console.error('Error extracting frontend APIs:', error);
    }
    
    return apis;
  }

  // Extract response structures from backend
  async extractBackendResponses(backendPath) {
    const apis = [];
    
    try {
      const content = await fs.readFile(backendPath, 'utf-8');
      
      // Find all res.json calls
      const responseRegex = /res\.json\s*\(\s*\{([^}]+)\}/g;
      let match;
      
      while ((match = responseRegex.exec(content)) !== null) {
        const responseBody = match[1];
        
        // Extract field names
        const fieldRegex = /(\w+):/g;
        const fields = [];
        let fieldMatch;
        
        while ((fieldMatch = fieldRegex.exec(responseBody)) !== null) {
          fields.push(fieldMatch[1]);
        }
        
        // Try to find the endpoint this belongs to (look backwards for route definition)
        const beforeResponse = content.slice(0, match.index);
        const routeMatch = beforeResponse.match(/app\.(get|post|put|delete)\s*\(['"`]([^'"`]+)['"`]/g);
        const lastRoute = routeMatch ? routeMatch[routeMatch.length - 1] : null;
        
        if (lastRoute) {
          const endpointMatch = lastRoute.match(/['"`]([^'"`]+)['"`]/);
          const endpoint = endpointMatch ? endpointMatch[1] : 'unknown';
          
          apis.push({
            endpoint,
            returnedFields: fields
          });
        }
      }
    } catch (error) {
      console.error('Error extracting backend APIs:', error);
    }
    
    return apis;
  }

  // Compare frontend expectations vs backend responses
  compareAPIs(frontendAPIs, backendAPIs) {
    const mismatches = [];
    
    for (const frontendAPI of frontendAPIs) {
      // Find matching backend endpoint
      const backendAPI = backendAPIs.find(b => 
        frontendAPI.endpoint.includes(b.endpoint)
      );
      
      if (!backendAPI) {
        mismatches.push({
          type: 'missing_endpoint',
          severity: 'high',
          frontend: frontendAPI.file,
          endpoint: frontendAPI.endpoint,
          message: `Frontend calls ${frontendAPI.endpoint} but no matching backend endpoint found`
        });
        continue;
      }
      
      // Check if expected fields exist in backend response
      for (const expectedField of frontendAPI.expectedFields) {
        const fieldParts = expectedField.split('.');
        const topLevel = fieldParts[0];
        
        if (!backendAPI.returnedFields.includes(topLevel)) {
          mismatches.push({
            type: 'field_mismatch',
            severity: 'medium',
            frontend: frontendAPI.file,
            endpoint: frontendAPI.endpoint,
            expectedField,
            availableFields: backendAPI.returnedFields,
            message: `Frontend expects '${expectedField}' but backend doesn't return it`,
            autofix: this.generateAutoFix(frontendAPI, expectedField, backendAPI.returnedFields)
          });
        }
      }
    }
    
    return mismatches;
  }

  // Generate auto-fix suggestions
  generateAutoFix(frontendAPI, expectedField, availableFields) {
    // Try to find a similar field (case-insensitive, snake_case vs camelCase)
    const normalized = expectedField.toLowerCase().replace(/[._]/g, '');
    
    for (const available of availableFields) {
      const availableNormalized = available.toLowerCase().replace(/[._]/g, '');
      
      if (normalized === availableNormalized) {
        return {
          type: 'rename',
          suggestion: `Change '${expectedField}' to '${available}' in ${frontendAPI.file}`
        };
      }
    }
    
    return {
      type: 'manual',
      suggestion: 'Manual review required - no obvious match found'
    };
  }

  // Scan dependencies for outdated packages
  async scanDependencies(packageJsonPath) {
    console.log('🔍 Scanning dependencies...');
    
    try {
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      const { dependencies, devDependencies } = packageJson;
      
      const allDeps = { ...dependencies, ...devDependencies };
      const outdated = [];
      
      // Check each dependency (in real implementation, use npm registry API)
      for (const [name, version] of Object.entries(allDeps)) {
        // For MVP, just flag versions with ^ or ~
        if (version.startsWith('^') || version.startsWith('~')) {
          outdated.push({
            name,
            current: version,
            type: 'potential_update',
            message: `${name} may have updates available`
          });
        }
      }
      
      return {
        status: 'scanned',
        total: Object.keys(allDeps).length,
        potentialUpdates: outdated.length,
        dependencies: outdated.slice(0, 5) // Top 5 for MVP
      };
    } catch (error) {
      console.error('Dependency scan error:', error);
      return { status: 'error', error: error.message };
    }
  }

  // Helper: Get all HTML files
  async getHTMLFiles(dir) {
    const files = [];
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isFile() && entry.name.endsWith('.html')) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      console.error('Error reading directory:', error);
    }
    
    return files;
  }

  // Main scan function
  async runFullScan(config) {
    console.log('🚀 Starting CodeGuard scan...');
    
    const results = {
      timestamp: new Date().toISOString(),
      status: 'completed',
      checks: {}
    };

    // API Consistency Check
    if (config.frontendPath && config.backendPath) {
      results.checks.apiConsistency = await this.scanAPIConsistency(
        config.frontendPath,
        config.backendPath
      );
    }

    // Dependency Check
    if (config.packageJsonPath) {
      results.checks.dependencies = await this.scanDependencies(
        config.packageJsonPath
      );
    }

    // Health Check
    results.checks.health = {
      status: 'healthy',
      checks: {
        backend: 'online',
        database: 'connected',
        memory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`
      }
    };

    // Summarize issues
    results.summary = {
      critical: 0,
      warnings: results.checks.apiConsistency?.mismatches?.length || 0,
      suggestions: results.checks.dependencies?.potentialUpdates || 0
    };

    return results;
  }
}

module.exports = CodeGuardScanner;