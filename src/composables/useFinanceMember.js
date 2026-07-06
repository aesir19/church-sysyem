import { ref } from 'vue'
import { supabase } from '../lib/supabase'

const isFinance = ref(false)
const loaded = ref(false)
let pending = null

export function useFinanceMember() {
  if (!loaded.value && !pending) {
    pending = supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (user) {
        const { data: account } = await supabase
          .from('user_accounts')
          .select('member_id')
          .eq('id', user.id)
          .maybeSingle()
        if (account?.member_id) {
          const { data: membership } = await supabase
            .from('group_members')
            .select('id, groups!inner(name)')
            .eq('member_id', account.member_id)
            .eq('groups.name', 'Finance Team')
            .maybeSingle()
          isFinance.value = !!membership
        }
      }
      loaded.value = true
    })
  }

  return { isFinance }
}
