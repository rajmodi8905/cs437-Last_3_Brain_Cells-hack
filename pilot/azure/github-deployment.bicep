targetScope = 'resourceGroup'

@description('Existing pilot VM. Deployment permission is assigned only at this VM scope.')
param vmName string = 'campusrecall-vm'

@description('Dedicated identity for GitHub deployment; no client secret is created.')
param identityName string = 'campusrecall-github-deploy'

@description('Exact subject reported by the repository OIDC configuration, including immutable IDs when enabled.')
param githubSubject string

resource vm 'Microsoft.Compute/virtualMachines@2024-07-01' existing = {
  name: vmName
}

resource deploymentIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: identityName
  location: resourceGroup().location
  tags: {
    project: 'campus-recall-pilot'
    scope: 'one-month-pilot'
    purpose: 'github-deployment'
  }
}

resource githubTrust 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = {
  parent: deploymentIdentity
  name: 'github-azure-pilot'
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    subject: githubSubject
    audiences: ['api://AzureADTokenExchange']
  }
}

// Run Command executes elevated code on this VM. This is privileged VM administration,
// not app-only access. It cannot start/delete VMs or grant roles/storage access via ARM.
resource deploymentRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: guid(resourceGroup().id, vm.id, 'github-pilot-deployment')
  properties: {
    roleName: '${vmName} GitHub deploy'
    description: 'Read and invoke Run Command on the pilot VM; no VM start/delete or role administration.'
    type: 'CustomRole'
    permissions: [
      {
        actions: [
          'Microsoft.Compute/virtualMachines/read'
          'Microsoft.Compute/virtualMachines/runCommand/action'
        ]
        notActions: []
        dataActions: []
        notDataActions: []
      }
    ]
    assignableScopes: [resourceGroup().id]
  }
}

resource deploymentAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: vm
  name: guid(vm.id, deploymentIdentity.id, deploymentRole.id)
  properties: {
    principalId: deploymentIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: deploymentRole.id
  }
}

output clientId string = deploymentIdentity.properties.clientId
output principalId string = deploymentIdentity.properties.principalId
output identityResourceId string = deploymentIdentity.id
output vmResourceId string = vm.id
output federatedSubject string = githubTrust.properties.subject
output roleDefinitionId string = deploymentRole.id
