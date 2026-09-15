#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testRelationships() {
  console.log('🔍 Testing new RapidAssessment → Incident relationships...');
  
  try {
    // Test 1: Get all assessments with their incidents
    const assessments = await prisma.rapidAssessment.findMany({
      include: {
        incident: {
          select: { id: true, type: true, description: true }
        },
        entity: {
          select: { id: true, name: true }
        }
      }
    });
    
    console.log(`📊 Found ${assessments.length} assessments with incident relationships:`);
    assessments.forEach(a => {
      console.log(`   - ${a.rapidAssessmentType} for ${a.entity.name} → ${a.incident.type} (${a.incident.id})`);
    });
    
    // Test 2: Get population impact for flood incident (answers JSON layer)
    const floodAssessments = await prisma.rapidAssessment.findMany({
      where: {
        incidentId: 'incident-flood-001',
        rapidAssessmentType: 'POPULATION'
      },
      include: {
        entity: { select: { name: true } }
      }
    });
    
    const totalPopulation = floodAssessments.reduce(
      (sum, a) => sum + ((a.answers && a.answers.totalPopulation) || 0),
      0
    );
    console.log(`🌊 Flood incident population impact: ${totalPopulation} people across ${floodAssessments.length} assessments`);
    
    // Test 3: Get population impact for drought incident (answers JSON layer)
    const droughtAssessments = await prisma.rapidAssessment.findMany({
      where: {
        incidentId: 'incident-drought-001',
        rapidAssessmentType: 'POPULATION'
      }
    });
    
    const droughtTotal = droughtAssessments.reduce(
      (sum, a) => sum + ((a.answers && a.answers.totalPopulation) || 0),
      0
    );
    console.log(`🌵 Drought incident population impact: ${droughtTotal} people across ${droughtAssessments.length} assessments`);
    
    console.log('✅ Relationship testing completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testRelationships();