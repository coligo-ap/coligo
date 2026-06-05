// Types de la base Supabase — schéma `public`.
//
// Maintenu à la main d'après supabase/migrations/ (0001 → 0004).
// `supabase gen types` nécessite Docker (indispo ici) ; on édite donc ce
// fichier à la main à chaque migration qui change le schéma.
// Pour régénérer automatiquement depuis la base (nécessite Docker OU un
// SUPABASE_ACCESS_TOKEN) :
//   npx supabase gen types typescript --project-id htxqzktwuymzetbdqghx > lib/supabase/database.types.ts
// ou, avec Docker lancé :
//   npx supabase gen types typescript --db-url "<connection-string>" > lib/supabase/database.types.ts

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      customer_favorites: {
        Row: {
          id: string;
          customer_id: string;
          merchant_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          customer_id: string;
          merchant_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          customer_id?: string;
          merchant_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      merchants: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          slug: string;
          category: string | null;
          city: string | null;
          wilaya_code: string | null;
          commune: string | null;
          address: string | null;
          latitude: number | null;
          longitude: number | null;
          description_fr: string | null;
          description_ar: string | null;
          logo_url: string | null;
          cover_url: string | null;
          phone_public: string | null;
          opening_hours: Json;
          min_order_da: number;
          prep_time_min: number;
          accepts_cash: boolean;
          accepts_online: boolean;
          pickup_slot_minutes: number;
          max_orders_per_slot: number | null;
          max_days_ahead: number;
          rating_avg: number;
          rating_count: number;
          is_active: boolean;
          commission_rate: number;
          commission_cash: number | null;
          commission_online: number | null;
          cashback_online: number | null;
          cashback_cash: number | null;
          is_frozen: boolean;
          auto_accept_orders: boolean;
          orders_paused: boolean;
          paused_until: string | null;
          closure_start: string | null;
          closure_end: string | null;
          manager_name: string | null;
          auto_print: Database["public"]["Enums"]["auto_print_mode"];
          print_copies: number;
          print_width: number;
          delivery_enabled: boolean;
          express_enabled: boolean;
          tours_enabled: boolean;
          delivery_radius_km: number | null;
          shop_public_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          slug?: string;
          category?: string | null;
          city?: string | null;
          wilaya_code?: string | null;
          commune?: string | null;
          address?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          description_fr?: string | null;
          description_ar?: string | null;
          logo_url?: string | null;
          cover_url?: string | null;
          phone_public?: string | null;
          opening_hours?: Json;
          min_order_da?: number;
          prep_time_min?: number;
          accepts_cash?: boolean;
          accepts_online?: boolean;
          pickup_slot_minutes?: number;
          max_orders_per_slot?: number | null;
          max_days_ahead?: number;
          rating_avg?: number;
          rating_count?: number;
          is_active?: boolean;
          commission_rate?: number;
          commission_cash?: number | null;
          commission_online?: number | null;
          cashback_online?: number | null;
          cashback_cash?: number | null;
          is_frozen?: boolean;
          auto_accept_orders?: boolean;
          orders_paused?: boolean;
          paused_until?: string | null;
          closure_start?: string | null;
          closure_end?: string | null;
          manager_name?: string | null;
          auto_print?: Database["public"]["Enums"]["auto_print_mode"];
          print_copies?: number;
          print_width?: number;
          delivery_enabled?: boolean;
          express_enabled?: boolean;
          tours_enabled?: boolean;
          delivery_radius_km?: number | null;
          shop_public_id?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          slug?: string;
          category?: string | null;
          city?: string | null;
          wilaya_code?: string | null;
          commune?: string | null;
          address?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          description_fr?: string | null;
          description_ar?: string | null;
          logo_url?: string | null;
          cover_url?: string | null;
          phone_public?: string | null;
          opening_hours?: Json;
          min_order_da?: number;
          prep_time_min?: number;
          accepts_cash?: boolean;
          accepts_online?: boolean;
          pickup_slot_minutes?: number;
          max_orders_per_slot?: number | null;
          max_days_ahead?: number;
          rating_avg?: number;
          rating_count?: number;
          is_active?: boolean;
          commission_rate?: number;
          commission_cash?: number | null;
          commission_online?: number | null;
          cashback_online?: number | null;
          cashback_cash?: number | null;
          is_frozen?: boolean;
          auto_accept_orders?: boolean;
          orders_paused?: boolean;
          paused_until?: string | null;
          closure_start?: string | null;
          closure_end?: string | null;
          manager_name?: string | null;
          auto_print?: Database["public"]["Enums"]["auto_print_mode"];
          print_copies?: number;
          print_width?: number;
          delivery_enabled?: boolean;
          express_enabled?: boolean;
          tours_enabled?: boolean;
          delivery_radius_km?: number | null;
          shop_public_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      orders: {
        Row: {
          id: string;
          merchant_id: string;
          customer_id: string | null;
          client_operation_id: string | null;
          customer_name: string;
          customer_phone: string;
          status: Database["public"]["Enums"]["order_status"];
          total_da: number;
          subtotal_da: number;
          discount_da: number;
          cashback_estimate_da: number;
          cashback_used_da: number;
          topup_used_da: number;
          service_fee_da: number;
          cashback_da: number;
          commission_da: number;
          pickup_code: string;
          order_number: string | null;
          pickup_type: Database["public"]["Enums"]["pickup_type"];
          pickup_slot_at: string;
          pickup_slot_start: string | null;
          pickup_slot_end: string | null;
          customer_note: string | null;
          notes: string | null;
          payment_method: Database["public"]["Enums"]["payment_method"];
          payment_status: Database["public"]["Enums"]["payment_status"];
          commission_rate_applied: number | null;
          cashback_rate_applied: number | null;
          chargily_fee_rate_applied: number | null;
          payment_failure_reason: string | null;
          fulfillment_type: "pickup" | "delivery";
          delivery_mode: "express" | "tour" | null;
          delivery_fee_da: number;
          delivery_address_id: string | null;
          delivery_address_text: string | null;
          delivery_lat: number | null;
          delivery_lng: number | null;
          delivery_phone: string | null;
          delivery_recipient_name: string | null;
          delivery_distance_km: number | null;
          delivery_driver_id: string | null;
          delivery_picked_up_at: string | null;
          delivery_arrived_at: string | null;
          delivery_delivered_at: string | null;
          driver_live_lat: number | null;
          driver_live_lng: number | null;
          driver_live_at: string | null;
          validated_without_code: boolean;
          delivery_slot_id: string | null;
          delivery_note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          merchant_id: string;
          customer_id?: string | null;
          client_operation_id?: string | null;
          customer_name: string;
          customer_phone: string;
          status?: Database["public"]["Enums"]["order_status"];
          total_da: number;
          subtotal_da?: number;
          discount_da?: number;
          cashback_estimate_da?: number;
          cashback_used_da?: number;
          topup_used_da?: number;
          service_fee_da?: number;
          cashback_da?: number;
          commission_da?: number;
          pickup_code?: string;
          pickup_type?: Database["public"]["Enums"]["pickup_type"];
          pickup_slot_at: string;
          pickup_slot_start?: string | null;
          pickup_slot_end?: string | null;
          customer_note?: string | null;
          notes?: string | null;
          payment_method?: Database["public"]["Enums"]["payment_method"];
          payment_status?: Database["public"]["Enums"]["payment_status"];
          commission_rate_applied?: number | null;
          cashback_rate_applied?: number | null;
          chargily_fee_rate_applied?: number | null;
          payment_failure_reason?: string | null;
          fulfillment_type?: "pickup" | "delivery";
          delivery_mode?: "express" | "tour" | null;
          delivery_fee_da?: number;
          delivery_address_id?: string | null;
          delivery_address_text?: string | null;
          delivery_lat?: number | null;
          delivery_lng?: number | null;
          delivery_phone?: string | null;
          delivery_recipient_name?: string | null;
          delivery_distance_km?: number | null;
          delivery_driver_id?: string | null;
          delivery_picked_up_at?: string | null;
          delivery_arrived_at?: string | null;
          delivery_delivered_at?: string | null;
          driver_live_lat?: number | null;
          driver_live_lng?: number | null;
          driver_live_at?: string | null;
          validated_without_code?: boolean;
          delivery_slot_id?: string | null;
          delivery_note?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          merchant_id?: string;
          customer_id?: string | null;
          client_operation_id?: string | null;
          customer_name?: string;
          customer_phone?: string;
          status?: Database["public"]["Enums"]["order_status"];
          total_da?: number;
          subtotal_da?: number;
          discount_da?: number;
          cashback_estimate_da?: number;
          cashback_used_da?: number;
          topup_used_da?: number;
          service_fee_da?: number;
          cashback_da?: number;
          commission_da?: number;
          pickup_code?: string;
          pickup_type?: Database["public"]["Enums"]["pickup_type"];
          pickup_slot_at?: string;
          pickup_slot_start?: string | null;
          pickup_slot_end?: string | null;
          customer_note?: string | null;
          notes?: string | null;
          payment_method?: Database["public"]["Enums"]["payment_method"];
          payment_status?: Database["public"]["Enums"]["payment_status"];
          commission_rate_applied?: number | null;
          cashback_rate_applied?: number | null;
          chargily_fee_rate_applied?: number | null;
          payment_failure_reason?: string | null;
          fulfillment_type?: "pickup" | "delivery";
          delivery_mode?: "express" | "tour" | null;
          delivery_fee_da?: number;
          delivery_address_id?: string | null;
          delivery_address_text?: string | null;
          delivery_lat?: number | null;
          delivery_lng?: number | null;
          delivery_phone?: string | null;
          delivery_recipient_name?: string | null;
          delivery_distance_km?: number | null;
          delivery_driver_id?: string | null;
          delivery_picked_up_at?: string | null;
          delivery_arrived_at?: string | null;
          delivery_delivered_at?: string | null;
          driver_live_lat?: number | null;
          driver_live_lng?: number | null;
          driver_live_at?: string | null;
          validated_without_code?: boolean;
          delivery_slot_id?: string | null;
          delivery_note?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "orders_merchant_id_fkey";
            columns: ["merchant_id"];
            referencedRelation: "merchants";
            referencedColumns: ["id"];
          },
        ];
      };
      products: {
        Row: {
          id: string;
          merchant_id: string;
          name_fr: string;
          name_ar: string | null;
          description_fr: string | null;
          description_ar: string | null;
          price_da: number;
          unit: Database["public"]["Enums"]["product_unit"];
          category: string | null;
          category_id: string | null;
          stock_qty: number | null;
          position: number;
          image_url: string | null;
          is_available: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          merchant_id: string;
          name_fr: string;
          name_ar?: string | null;
          description_fr?: string | null;
          description_ar?: string | null;
          price_da: number;
          unit?: Database["public"]["Enums"]["product_unit"];
          category?: string | null;
          category_id?: string | null;
          stock_qty?: number | null;
          position?: number;
          image_url?: string | null;
          is_available?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          merchant_id?: string;
          name_fr?: string;
          name_ar?: string | null;
          description_fr?: string | null;
          description_ar?: string | null;
          price_da?: number;
          unit?: Database["public"]["Enums"]["product_unit"];
          category?: string | null;
          category_id?: string | null;
          stock_qty?: number | null;
          position?: number;
          image_url?: string | null;
          is_available?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "products_merchant_id_fkey";
            columns: ["merchant_id"];
            referencedRelation: "merchants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "products_category_id_fkey";
            columns: ["category_id"];
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      categories: {
        Row: {
          id: string;
          merchant_id: string;
          title: string;
          description: string | null;
          image_url: string | null;
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          merchant_id: string;
          title: string;
          description?: string | null;
          image_url?: string | null;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          merchant_id?: string;
          title?: string;
          description?: string | null;
          image_url?: string | null;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "categories_merchant_id_fkey";
            columns: ["merchant_id"];
            referencedRelation: "merchants";
            referencedColumns: ["id"];
          },
        ];
      };
      order_events: {
        Row: {
          id: string;
          order_id: string;
          from_status: Database["public"]["Enums"]["order_status"] | null;
          to_status: Database["public"]["Enums"]["order_status"];
          client_operation_id: string | null;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          from_status?: Database["public"]["Enums"]["order_status"] | null;
          to_status: Database["public"]["Enums"]["order_status"];
          client_operation_id?: string | null;
          note?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          from_status?: Database["public"]["Enums"]["order_status"] | null;
          to_status?: Database["public"]["Enums"]["order_status"];
          client_operation_id?: string | null;
          note?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_events_order_id_fkey";
            columns: ["order_id"];
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      order_items: {
        Row: {
          id: string;
          order_id: string;
          product_name: string;
          unit_price_da: number;
          quantity: number;
          line_total_da: number;
        };
        Insert: {
          id?: string;
          order_id: string;
          product_name: string;
          unit_price_da: number;
          quantity: number;
          line_total_da: number;
        };
        Update: {
          id?: string;
          order_id?: string;
          product_name?: string;
          unit_price_da?: number;
          quantity?: number;
          line_total_da?: number;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      promotions: {
        Row: {
          id: string;
          merchant_id: string;
          type: Database["public"]["Enums"]["promotion_type"];
          title_fr: string;
          title_ar: string | null;
          status: Database["public"]["Enums"]["promotion_status"];
          discount_kind: Database["public"]["Enums"]["discount_kind"] | null;
          discount_value: number | null;
          code: string | null;
          buy_qty: number | null;
          get_qty: number | null;
          starts_at: string | null;
          ends_at: string | null;
          max_uses: number | null;
          max_uses_per_customer: number | null;
          uses_count: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          merchant_id: string;
          type: Database["public"]["Enums"]["promotion_type"];
          title_fr: string;
          title_ar?: string | null;
          status?: Database["public"]["Enums"]["promotion_status"];
          discount_kind?: Database["public"]["Enums"]["discount_kind"] | null;
          discount_value?: number | null;
          code?: string | null;
          buy_qty?: number | null;
          get_qty?: number | null;
          starts_at?: string | null;
          ends_at?: string | null;
          max_uses?: number | null;
          max_uses_per_customer?: number | null;
          uses_count?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          merchant_id?: string;
          type?: Database["public"]["Enums"]["promotion_type"];
          title_fr?: string;
          title_ar?: string | null;
          status?: Database["public"]["Enums"]["promotion_status"];
          discount_kind?: Database["public"]["Enums"]["discount_kind"] | null;
          discount_value?: number | null;
          code?: string | null;
          buy_qty?: number | null;
          get_qty?: number | null;
          starts_at?: string | null;
          ends_at?: string | null;
          max_uses?: number | null;
          max_uses_per_customer?: number | null;
          uses_count?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "promotions_merchant_id_fkey";
            columns: ["merchant_id"];
            referencedRelation: "merchants";
            referencedColumns: ["id"];
          },
        ];
      };
      promotion_products: {
        Row: {
          promotion_id: string;
          product_id: string;
        };
        Insert: {
          promotion_id: string;
          product_id: string;
        };
        Update: {
          promotion_id?: string;
          product_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "promotion_products_promotion_id_fkey";
            columns: ["promotion_id"];
            referencedRelation: "promotions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "promotion_products_product_id_fkey";
            columns: ["product_id"];
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      wallet_entries: {
        Row: {
          id: string;
          merchant_id: string;
          order_id: string | null;
          type: Database["public"]["Enums"]["wallet_entry_type"];
          amount_da: number;
          commission_rate: number | null;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          merchant_id: string;
          order_id?: string | null;
          type: Database["public"]["Enums"]["wallet_entry_type"];
          amount_da: number;
          commission_rate?: number | null;
          note?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          merchant_id?: string;
          order_id?: string | null;
          type?: Database["public"]["Enums"]["wallet_entry_type"];
          amount_da?: number;
          commission_rate?: number | null;
          note?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "wallet_entries_merchant_id_fkey";
            columns: ["merchant_id"];
            referencedRelation: "merchants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "wallet_entries_order_id_fkey";
            columns: ["order_id"];
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      payout_requests: {
        Row: {
          id: string;
          merchant_id: string;
          amount_da: number;
          status: Database["public"]["Enums"]["payout_status"];
          method: string;
          details: string | null;
          processed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          merchant_id: string;
          amount_da: number;
          status?: Database["public"]["Enums"]["payout_status"];
          method: string;
          details?: string | null;
          processed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          merchant_id?: string;
          amount_da?: number;
          status?: Database["public"]["Enums"]["payout_status"];
          method?: string;
          details?: string | null;
          processed_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payout_requests_merchant_id_fkey";
            columns: ["merchant_id"];
            referencedRelation: "merchants";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_settings: {
        Row: {
          id: boolean;
          commission_cash: number;
          commission_online: number;
          cashback_online: number;
          cashback_cash: number;
          chargily_fee: number;
          max_debt_da: number;
          max_topup_da_per_30d: number;
          service_fee_tiers: Json;
          ranking_weights: Json;
          delivery_base_da: number;
          delivery_per_km_da: number;
          delivery_free_km_threshold: number;
          delivery_min_da: number;
          delivery_max_da: number;
          delivery_max_radius_km: number;
          updated_at: string;
        };
        Insert: {
          id?: boolean;
          commission_cash?: number;
          commission_online?: number;
          cashback_online?: number;
          cashback_cash?: number;
          chargily_fee?: number;
          max_debt_da?: number;
          max_topup_da_per_30d?: number;
          service_fee_tiers?: Json;
          ranking_weights?: Json;
          delivery_base_da?: number;
          delivery_per_km_da?: number;
          delivery_free_km_threshold?: number;
          delivery_min_da?: number;
          delivery_max_da?: number;
          delivery_max_radius_km?: number;
          updated_at?: string;
        };
        Update: {
          id?: boolean;
          commission_cash?: number;
          commission_online?: number;
          cashback_online?: number;
          cashback_cash?: number;
          chargily_fee?: number;
          max_debt_da?: number;
          max_topup_da_per_30d?: number;
          service_fee_tiers?: Json;
          ranking_weights?: Json;
          delivery_base_da?: number;
          delivery_per_km_da?: number;
          delivery_free_km_threshold?: number;
          delivery_min_da?: number;
          delivery_max_da?: number;
          delivery_max_radius_km?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      drivers: {
        Row: {
          id: string;
          user_id: string | null;
          full_name: string;
          phone: string;
          email: string | null;
          wilaya: string | null;
          is_frozen: boolean;
          rating_avg: number;
          rating_count: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          full_name: string;
          phone: string;
          email?: string | null;
          wilaya?: string | null;
          is_frozen?: boolean;
          rating_avg?: number;
          rating_count?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          full_name?: string;
          phone?: string;
          email?: string | null;
          wilaya?: string | null;
          is_frozen?: boolean;
          rating_avg?: number;
          rating_count?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      driver_reviews: {
        Row: {
          id: string;
          order_id: string;
          customer_id: string;
          driver_id: string;
          rating: number;
          comment: string | null;
          is_hidden: boolean;
          created_at: string;
          edited_at: string | null;
        };
        Insert: {
          id?: string;
          order_id: string;
          customer_id: string;
          driver_id: string;
          rating: number;
          comment?: string | null;
          is_hidden?: boolean;
          created_at?: string;
          edited_at?: string | null;
        };
        Update: {
          id?: string;
          order_id?: string;
          customer_id?: string;
          driver_id?: string;
          rating?: number;
          comment?: string | null;
          is_hidden?: boolean;
          created_at?: string;
          edited_at?: string | null;
        };
        Relationships: [];
      };
      merchant_referral_codes: {
        Row: {
          id: string;
          merchant_id: string;
          code_hash: string;
          is_active: boolean;
          expires_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          merchant_id: string;
          code_hash: string;
          is_active?: boolean;
          expires_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          merchant_id?: string;
          code_hash?: string;
          is_active?: boolean;
          expires_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      merchant_drivers: {
        Row: {
          id: string;
          merchant_id: string;
          driver_id: string;
          status: "pending" | "active" | "blocked";
          joined_at: string;
          status_changed_at: string;
          sessions_revoked_at: string | null;
        };
        Insert: {
          id?: string;
          merchant_id: string;
          driver_id: string;
          status?: "pending" | "active" | "blocked";
          joined_at?: string;
          status_changed_at?: string;
          sessions_revoked_at?: string | null;
        };
        Update: {
          id?: string;
          merchant_id?: string;
          driver_id?: string;
          status?: "pending" | "active" | "blocked";
          joined_at?: string;
          status_changed_at?: string;
          sessions_revoked_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "merchant_drivers_driver_id_fkey";
            columns: ["driver_id"];
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "merchant_drivers_merchant_id_fkey";
            columns: ["merchant_id"];
            referencedRelation: "merchants";
            referencedColumns: ["id"];
          },
        ];
      };
      merchant_driver_events: {
        Row: {
          id: string;
          merchant_id: string;
          driver_id: string | null;
          actor_email: string | null;
          action: string;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          merchant_id: string;
          driver_id?: string | null;
          actor_email?: string | null;
          action: string;
          note?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          merchant_id?: string;
          driver_id?: string | null;
          actor_email?: string | null;
          action?: string;
          note?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      platform_ledger: {
        Row: {
          id: string;
          order_id: string | null;
          type: Database["public"]["Enums"]["platform_ledger_type"];
          amount_da: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id?: string | null;
          type: Database["public"]["Enums"]["platform_ledger_type"];
          amount_da: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string | null;
          type?: Database["public"]["Enums"]["platform_ledger_type"];
          amount_da?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "platform_ledger_order_id_fkey";
            columns: ["order_id"];
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      cashback_grants: {
        Row: {
          id: string;
          order_id: string | null;
          customer_phone: string | null;
          amount_da: number;
          status: Database["public"]["Enums"]["cashback_status"];
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id?: string | null;
          customer_phone?: string | null;
          amount_da: number;
          status?: Database["public"]["Enums"]["cashback_status"];
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string | null;
          customer_phone?: string | null;
          amount_da?: number;
          status?: Database["public"]["Enums"]["cashback_status"];
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cashback_grants_order_id_fkey";
            columns: ["order_id"];
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_admins: {
        Row: { email: string; created_at: string };
        Insert: { email: string; created_at?: string };
        Update: { email?: string; created_at?: string };
        Relationships: [];
      };
      reviews: {
        Row: {
          id: string;
          order_id: string;
          customer_id: string;
          merchant_id: string;
          rating: number;
          comment: string | null;
          is_hidden: boolean;
          created_at: string;
          edited_at: string | null;
        };
        Insert: {
          id?: string;
          order_id: string;
          customer_id: string;
          merchant_id: string;
          rating: number;
          comment?: string | null;
          is_hidden?: boolean;
          created_at?: string;
          edited_at?: string | null;
        };
        Update: {
          rating?: number;
          comment?: string | null;
          is_hidden?: boolean;
        };
        Relationships: [];
      };
      promo_banners: {
        Row: {
          id: string;
          title: string;
          subtitle: string | null;
          cta_label: string | null;
          image_url: string | null;
          link: string | null;
          accent: "violet" | "coral" | "mint" | "amber" | "dark";
          position: number;
          active: boolean;
          starts_at: string | null;
          ends_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      customers: {
        Row: {
          id: string;
          user_id: string;
          full_name: string;
          phone: string;
          email: string | null;
          default_wilaya_code: string | null;
          default_commune: string | null;
          latitude: number | null;
          longitude: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          full_name: string;
          phone: string;
          email?: string | null;
          default_wilaya_code?: string | null;
          default_commune?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          full_name?: string;
          phone?: string;
          email?: string | null;
          default_wilaya_code?: string | null;
          default_commune?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      device_tokens: {
        Row: {
          id: string;
          user_id: string;
          role: "merchant" | "customer" | "courier";
          token: string;
          platform: "android" | "ios" | "web";
          created_at: string;
          last_seen_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          role: "merchant" | "customer" | "courier";
          token: string;
          platform: "android" | "ios" | "web";
          created_at?: string;
          last_seen_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          role?: "merchant" | "customer" | "courier";
          token?: string;
          platform?: "android" | "ios" | "web";
          created_at?: string;
          last_seen_at?: string;
        };
        Relationships: [];
      };
      customer_addresses: {
        Row: {
          id: string;
          customer_id: string;
          label: string;
          lat: number;
          lng: number;
          address_text: string | null;
          phone_override: string | null;
          is_default: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          customer_id: string;
          label: string;
          lat: number;
          lng: number;
          address_text?: string | null;
          phone_override?: string | null;
          is_default?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          customer_id?: string;
          label?: string;
          lat?: number;
          lng?: number;
          address_text?: string | null;
          phone_override?: string | null;
          is_default?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      driver_availability: {
        Row: {
          merchant_driver_id: string;
          status: "offline" | "available" | "busy";
          current_order_id: string | null;
          updated_at: string;
        };
        Insert: {
          merchant_driver_id: string;
          status?: "offline" | "available" | "busy";
          current_order_id?: string | null;
          updated_at?: string;
        };
        Update: {
          merchant_driver_id?: string;
          status?: "offline" | "available" | "busy";
          current_order_id?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      delivery_slots: {
        Row: {
          id: string;
          merchant_id: string;
          slot_date: string;
          start_time: string;
          end_time: string;
          max_orders: number;
          status: "open" | "closed" | "cancelled";
          created_at: string;
        };
        Insert: {
          id?: string;
          merchant_id: string;
          slot_date: string;
          start_time: string;
          end_time: string;
          max_orders: number;
          status?: "open" | "closed" | "cancelled";
          created_at?: string;
        };
        Update: {
          id?: string;
          merchant_id?: string;
          slot_date?: string;
          start_time?: string;
          end_time?: string;
          max_orders?: number;
          status?: "open" | "closed" | "cancelled";
          created_at?: string;
        };
        Relationships: [];
      };
      delivery_tours: {
        Row: {
          id: string;
          merchant_id: string;
          driver_id: string;
          slot_id: string;
          status: "planned" | "in_progress" | "completed" | "cancelled";
          started_at: string | null;
          ended_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          merchant_id: string;
          driver_id: string;
          slot_id: string;
          status?: "planned" | "in_progress" | "completed" | "cancelled";
          started_at?: string | null;
          ended_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          merchant_id?: string;
          driver_id?: string;
          slot_id?: string;
          status?: "planned" | "in_progress" | "completed" | "cancelled";
          started_at?: string | null;
          ended_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      tour_stops: {
        Row: {
          id: string;
          tour_id: string;
          order_id: string;
          stop_order: number;
          status: "pending" | "delivered" | "failed";
          delivered_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tour_id: string;
          order_id: string;
          stop_order: number;
          status?: "pending" | "delivered" | "failed";
          delivered_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tour_id?: string;
          order_id?: string;
          stop_order?: number;
          status?: "pending" | "delivered" | "failed";
          delivered_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      delivery_ledger: {
        Row: {
          id: string;
          driver_id: string;
          merchant_id: string | null;
          order_id: string | null;
          type:
            | "driver_payout"
            | "driver_cash_collected"
            | "driver_owes_platform"
            | "driver_owes_merchant"
            | "adjustment";
          amount_da: number;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          driver_id: string;
          merchant_id?: string | null;
          order_id?: string | null;
          type:
            | "driver_payout"
            | "driver_cash_collected"
            | "driver_owes_platform"
            | "driver_owes_merchant"
            | "adjustment";
          amount_da: number;
          note?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          driver_id?: string;
          merchant_id?: string | null;
          order_id?: string | null;
          type?:
            | "driver_payout"
            | "driver_cash_collected"
            | "driver_owes_platform"
            | "driver_owes_merchant"
            | "adjustment";
          amount_da?: number;
          note?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      admin_audit_log: {
        Row: {
          id: string;
          admin_email: string | null;
          action: string;
          target_kind: string;
          target_id: string | null;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          admin_email?: string | null;
          action: string;
          target_kind: string;
          target_id?: string | null;
          note?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          admin_email?: string | null;
          action?: string;
          target_kind?: string;
          target_id?: string | null;
          note?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      merchants_public: {
        Row: {
          id: string;
          slug: string;
          name: string;
          category: string | null;
          description_fr: string | null;
          description_ar: string | null;
          logo_url: string | null;
          cover_url: string | null;
          phone_public: string | null;
          city: string | null;
          commune: string | null;
          wilaya_code: string | null;
          address: string | null;
          latitude: number | null;
          longitude: number | null;
          opening_hours: Json;
          min_order_da: number;
          prep_time_min: number;
          accepts_cash: boolean;
          accepts_online: boolean;
          pickup_slot_minutes: number;
          max_orders_per_slot: number | null;
          max_days_ahead: number;
          rating_avg: number;
          rating_count: number;
          is_active: boolean;
          delivery_enabled: boolean;
          express_enabled: boolean;
          tours_enabled: boolean;
          delivery_radius_km: number | null;
          shop_public_id: string;
          created_at: string;
          orders_paused: boolean;
          paused_until: string | null;
          closure_start: string | null;
          closure_end: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      customer_wallet_entries: {
        Row: {
          id: string;
          customer_id: string;
          order_id: string | null;
          type:
            | "cashback_earned"
            | "cashback_spent"
            | "adjustment"
            | "topup_credit"
            | "topup_spent";
          source: "cashback" | "topup";
          amount_da: number;
          note: string | null;
          chargily_checkout_id: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Functions: {
      merchant_balance: {
        Args: { p_merchant_id: string };
        Returns: number;
      };
      order_driver_contact: {
        Args: { p_order_id: string };
        Returns: { first_name: string | null; phone: string | null }[];
      };
      customer_cashback_balance: {
        Args: { p_customer_id: string };
        Returns: number;
      };
      customer_topup_balance: {
        Args: { p_customer_id: string };
        Returns: number;
      };
      customer_topup_credited_last_30d: {
        Args: { p_customer_id: string };
        Returns: number;
      };
      compute_service_fee_da: {
        Args: { p_products_da: number };
        Returns: number;
      };
      is_super_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      resolve_rate: {
        Args: { p_merchant_id: string; p_key: string };
        Returns: number;
      };
      slugify: {
        Args: { p_input: string };
        Returns: string;
      };
      merchant_unique_slug: {
        Args: { p_base: string; p_self_id?: string | null };
        Returns: string;
      };
      set_driver_availability: {
        Args: {
          p_merchant_driver_id: string;
          p_status: "offline" | "available" | "busy";
        };
        Returns: void;
      };
      pull_next_express: {
        Args: { p_merchant_driver_id: string };
        Returns: { order_id: string }[];
      };
      validate_delivery: {
        Args: {
          p_order_id: string;
          p_provided_code: string | null;
          p_skip_code?: boolean;
          p_client_operation_id?: string | null;
        };
        Returns: { ok: boolean; reason: string | null }[];
      };
      mark_delivery_picked_up: {
        Args: { p_order_id: string };
        Returns: { ok: boolean; reason: string | null }[];
      };
      release_express_order: {
        Args: { p_order_id: string };
        Returns: { ok: boolean; reason: string | null }[];
      };
      mark_delivery_arrived: {
        Args: { p_order_id: string };
        Returns: { ok: boolean; reason: string | null }[];
      };
      mark_tour_picked_up: {
        Args: { p_tour_id: string };
        Returns: { updated: number }[];
      };
      reorder_tour_from: {
        Args: {
          p_tour_id: string;
          p_from_lat: number;
          p_from_lng: number;
        };
        Returns: { reordered: number }[];
      };
      update_driver_live_location: {
        Args: {
          p_order_id: string;
          p_lat: number;
          p_lng: number;
        };
        Returns: { ok: boolean; reason: string | null }[];
      };
      driver_delivery_counts: {
        Args: Record<string, never>;
        Returns: {
          merchant_driver_id: string;
          merchant_id: string;
          merchant_name: string;
          express_enabled: boolean;
          tours_enabled: boolean;
          express_available: number;
          tour_pending: number;
        }[];
      };
    };
    Enums: {
      order_status:
        | "pending"
        | "accepted"
        | "preparing"
        | "ready"
        | "completed"
        | "cancelled";
      product_unit: "piece" | "kg" | "l" | "m" | "custom";
      promotion_type: "product_discount" | "promo_code" | "quantity_offer";
      promotion_status: "scheduled" | "active" | "expired" | "disabled";
      discount_kind: "percent" | "amount";
      wallet_entry_type:
        | "sale"
        | "commission"
        | "service_fee"
        | "service_fee_owed"
        | "payout"
        | "adjustment";
      payout_status: "pending" | "approved" | "paid" | "rejected";
      payment_method: "cash" | "online";
      payment_status: "pending" | "paid" | "failed" | "refunded";
      cashback_status: "pending" | "granted";
      platform_ledger_type:
        | "commission_income"
        | "service_fee_income"
        | "chargily_fee"
        | "cashback_expense";
      auto_print_mode: "off" | "on_receive" | "on_accept";
      pickup_type: "asap" | "slot";
    };
    CompositeTypes: Record<never, never>;
  };
};
