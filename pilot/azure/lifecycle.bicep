targetScope = 'resourceGroup'

@description('Existing pilot VM in this resource group; it must have a system-assigned identity.')
param vmName string

resource vm 'Microsoft.Compute/virtualMachines@2024-07-01' existing = {
  name: vmName
}

// Deallocation stops compute billing without deleting the VM, disks or stored data.
resource selfDeallocate 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: guid(resourceGroup().id, vm.id, 'pilot-self-deallocate')
  properties: {
    roleName: '${vmName} self deallocate'
    description: 'Pilot cutoff: this VM may only deallocate itself; no delete, start or storage rights.'
    type: 'CustomRole'
    permissions: [
      {
        actions: ['Microsoft.Compute/virtualMachines/deallocate/action']
        notActions: []
        dataActions: []
        notDataActions: []
      }
    ]
    assignableScopes: [resourceGroup().id]
  }
}

resource selfDeallocateAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: vm
  name: guid(vm.id, selfDeallocate.id)
  properties: {
    principalId: vm.identity!.principalId!
    principalType: 'ServicePrincipal'
    roleDefinitionId: selfDeallocate.id
  }
}

output vmResourceId string = vm.id
output roleDefinitionId string = selfDeallocate.id
output roleAssignmentId string = selfDeallocateAssignment.id
