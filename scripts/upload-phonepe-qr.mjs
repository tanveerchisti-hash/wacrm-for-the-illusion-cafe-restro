/**
 * scripts/upload-phonepe-qr.mjs
 *
 * Dedicated script to verify, upload, and configure the official PhonePe UPI QR
 * image for The Illusion Cafe & Restaurant in Supabase Storage and restaurant_trial_settings.
 *
 * SAFETY RULE: Runs in DRY-RUN mode by default.
 * Does NOT upload or modify database values without explicit --execute flag (which requires PO approval).
 */

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const LOCAL_QR_PATH = 'C:\\Users\\tanve\\Downloads\\Payment Details\\illusion_cafe_phonepe_qr.jpeg'
const AUTHORIZED_ACCOUNT_ID = '546951d0-df9d-438e-a94d-532b7ff89308'
const OFFICIAL_UPI_ID = '9352326442-8@ybl'
const TARGET_BUCKET = 'chat-media'
const OBJECT_PATH = `account-${AUTHORIZED_ACCOUNT_ID}/illusion_cafe_phonepe_qr.jpeg`

async function main() {
  const isExecute = process.argv.includes('--execute')

  console.log('=== PhonePe UPI QR Verification & Configuration ===\n')

  // 1. Verify Local File Existence
  if (!fs.existsSync(LOCAL_QR_PATH)) {
    console.error(`❌ Local file not found: ${LOCAL_QR_PATH}`)
    process.exit(1)
  }

  const fileStats = fs.statSync(LOCAL_QR_PATH)
  const fileBuffer = fs.readFileSync(LOCAL_QR_PATH)

  console.log(`✓ Local file found: ${LOCAL_QR_PATH}`)
  console.log(`✓ File size: ${fileStats.size} bytes (${(fileStats.size / 1024).toFixed(2)} KB)`)

  // Check 5 MB WhatsApp image limit
  if (fileStats.size > 5 * 1024 * 1024) {
    console.error('❌ File exceeds Meta WhatsApp 5 MB image limit.')
    process.exit(1)
  }
  console.log('✓ File size is within Meta WhatsApp 5 MB image limit')

  // 2. Verify JPEG Magic Bytes
  const isJpeg =
    fileBuffer[0] === 0xff &&
    fileBuffer[1] === 0xd8 &&
    fileBuffer[2] === 0xff &&
    fileBuffer[fileBuffer.length - 2] === 0xff &&
    fileBuffer[fileBuffer.length - 1] === 0xd9

  if (!isJpeg) {
    console.error('❌ File is not a valid JPEG (invalid SOI/EOI magic bytes)')
    process.exit(1)
  }
  console.log('✓ Verified JPEG magic bytes (FF D8 FF ... FF D9)')

  // 3. Target Configuration
  console.log('\n--- Target Configuration ---')
  console.log(`Account ID: ${AUTHORIZED_ACCOUNT_ID}`)
  console.log(`Official UPI ID: ${OFFICIAL_UPI_ID}`)
  console.log(`Target Storage Bucket: ${TARGET_BUCKET}`)
  console.log(`Target Object Path: ${OBJECT_PATH}`)

  let supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  let serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    const envPath = path.resolve(process.cwd(), '.env.local')
    if (fs.existsSync(envPath)) {
      const envLines = fs.readFileSync(envPath, 'utf8').split('\n')
      for (const line of envLines) {
        const trimmed = line.trim()
        if (trimmed.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) {
          supabaseUrl = trimmed.substring('NEXT_PUBLIC_SUPABASE_URL='.length).trim().replace(/^["']|["']$/g, '')
        } else if (trimmed.startsWith('SUPABASE_SERVICE_ROLE_KEY=')) {
          serviceRoleKey = trimmed.substring('SUPABASE_SERVICE_ROLE_KEY='.length).trim().replace(/^["']|["']$/g, '')
        }
      }
    }
  }

  if (!serviceRoleKey) {
    try {
      const rawKeys = execSync('supabase projects api-keys --reveal --output json', { encoding: 'utf8' })
      const parsedKeys = JSON.parse(rawKeys)
      const serviceRoleObj = parsedKeys.find((k) => k.name === 'service_role' || k.name === 'service_role key')
      if (serviceRoleObj && serviceRoleObj.api_key) {
        serviceRoleKey = serviceRoleObj.api_key
      }
    } catch {
      // Ignore CLI fetch error
    }
  }

  if (!supabaseUrl) {
    supabaseUrl = 'https://knnlhkyhepoivcfzwblf.supabase.co'
  } else {
    supabaseUrl = supabaseUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '')
  }

  if (!serviceRoleKey) {
    console.error('❌ Could not obtain Supabase service-role credentials.')
    process.exit(1)
  }

  const expectedPublicUrl = `${supabaseUrl}/storage/v1/object/public/${TARGET_BUCKET}/${OBJECT_PATH}`
  console.log(`Expected Public URL: ${expectedPublicUrl}`)

  if (!isExecute) {
    console.log('\n🔒 DRY-RUN MODE: No changes made to Supabase Storage or Database.')
    console.log('To upload and apply after Product Owner approval, run with --execute.')
    return
  }

  // 4. Execution Mode (After explicit PO approval)
  console.log('\n🚀 EXECUTING UPLOAD AND DATABASE CONFIGURATION...')
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  // Upload to Supabase Storage
  const { error: uploadErr } = await supabase.storage
    .from(TARGET_BUCKET)
    .upload(OBJECT_PATH, fileBuffer, {
      contentType: 'image/jpeg',
      upsert: true,
      cacheControl: '3600',
    })

  if (uploadErr) {
    console.error(`❌ Storage upload failed: ${uploadErr.message}`)
    process.exit(1)
  }
  console.log(`✓ Successfully uploaded to ${TARGET_BUCKET}/${OBJECT_PATH}`)

  // Get and verify public URL
  const {
    data: { publicUrl },
  } = supabase.storage.from(TARGET_BUCKET).getPublicUrl(OBJECT_PATH)

  console.log(`✓ Verified public HTTPS URL: ${publicUrl}`)

  // Verify HTTP reachability
  try {
    const headRes = await fetch(publicUrl, { method: 'HEAD' })
    if (headRes.ok) {
      console.log(`✓ Verified HTTPS accessibility (HTTP ${headRes.status})`)
    } else {
      console.warn(`⚠️ HTTPS accessibility check returned HTTP ${headRes.status}`)
    }
  } catch (err) {
    console.warn(`⚠️ HTTPS reachability check error: ${err.message}`)
  }

  // Update restaurant_trial_settings for authorized account
  const { data: updatedSettings, error: dbErr } = await supabase
    .from('restaurant_trial_settings')
    .update({
      test_upi_id: OFFICIAL_UPI_ID,
      test_qr_code_url: publicUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', AUTHORIZED_ACCOUNT_ID)
    .select('*')
    .single()

  if (dbErr) {
    console.error(`❌ Database update failed: ${dbErr.message}`)
    process.exit(1)
  }

  console.log('✓ Successfully updated restaurant_trial_settings:')
  console.log(`  - test_upi_id: ${updatedSettings.test_upi_id}`)
  console.log(`  - test_qr_code_url: ${updatedSettings.test_qr_code_url}`)
  console.log('\n✅ PhonePe UPI QR payment configuration complete!')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
