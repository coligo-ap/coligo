// Types de la base Supabase â€” schÃ©ma `public`.
//
// Maintenu Ã  la main d'aprÃ¨s supabase/migrations/ (0001 â†’ 0004).
// `supabase gen types` nÃ©cessite Docker (indispo ici) ; on Ã©dite donc ce
// fichier Ã  la main Ã  chaque migration qui change le schÃ©ma.
// Pour rÃ©gÃ©nÃ©rer automatiquement depuis la base (nÃ©cessite Docker OU un
// SUPABASE_ACCESS_TOKEN) :
//   npx supabase gen types typescript --project-id htxqzktwuymzetbdqghx > lib/supabase/database.types.ts
// ou, avec Docker lancÃ© :
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
      chauffeurs: {
        Row: {
          id: string;
          user_id: string | null;
          full_name: string;
          phone: string;
          email: string | null;
          wilaya: string | null;
          vehicle_make: string | null;
          vehicle_model: string | null;
          vehicle_plate: string | null;
          vehicle_color: string | null;
          is_verified: boolean;
          is_frozen: boolean;
          is_blocked: boolean;
          created_at: string;
          // Drive (mig 0139)
          first_name: string | null;
          birth_date: string | null;
          city: string | null;
          gamme: "classic" | "confort" | "moto";
          is_female: boolean;
          is_female_verified: boolean;
          home_addr_text: string | null;
          home_lat: number | null;
          home_lng: number | null;
          home_dir_date: string | null;
          home_dir_count: number;
          selfie_url: string | null;
          submitted_at: string | null;
          verified_at: string | null;
          rejected_reason: string | null;
          frozen_reason: string | null;
          frozen_at: string | null;
          sos_contacts: unknown;
          is_demo: boolean;
          ccp_number: string | null;
          ccp_key: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          full_name: string;
          phone: string;
          email?: string | null;
          wilaya?: string | null;
          vehicle_make?: string | null;
          vehicle_model?: string | null;
          vehicle_plate?: string | null;
          vehicle_color?: string | null;
          is_verified?: boolean;
          is_frozen?: boolean;
          is_blocked?: boolean;
          created_at?: string;
          [k: string]: unknown;
        };
        Update: Partial<Database["public"]["Tables"]["chauffeurs"]["Insert"]>;
        Relationships: [];
      };
      chauffeur_presence: {
        Row: {
          chauffeur_id: string;
          lat: number;
          lng: number;
          is_online: boolean;
          updated_at: string;
        };
        Insert: {
          chauffeur_id: string;
          lat: number;
          lng: number;
          is_online?: boolean;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["chauffeur_presence"]["Insert"]
        >;
        Relationships: [];
      };
      rides: {
        Row: {
          id: string;
          customer_id: string;
          chauffeur_id: string | null;
          status:
            | "searching"
            | "accepted"
            | "arriving"
            | "arrived"
            | "in_progress"
            | "completed"
            | "cancelled";
          pickup_lat: number;
          pickup_lng: number;
          pickup_text: string | null;
          dest_lat: number;
          dest_lng: number;
          dest_text: string | null;
          distance_km: number;
          suggested_price_da: number;
          proposed_price_da: number;
          agreed_price_da: number | null;
          payment_method: "cash" | "card" | "coligo_pay";
          commission_rate_applied: number | null;
          commission_da: number | null;
          chauffeur_net_da: number | null;
          cancelled_by: string | null;
          client_rating: number | null;
          chauffeur_rating: number | null;
          created_at: string;
          accepted_at: string | null;
          arrived_at: string | null;
          started_at: string | null;
          completed_at: string | null;
          cancelled_at: string | null;
          // Drive (mig 0139-0143)
          gamme: "classic" | "confort" | "moto";
          boost_amount_da: number;
          female_only: boolean;
          proxy_name: string | null;
          proxy_phone: string | null;
          client_phone_shared: boolean;
          share_token: string | null;
          cashback_da: number;
          client_operation_id: string | null;
          expires_at: string | null;
          female_notified_at: string | null;
          online_paid_at: string | null;
          chargily_checkout_id: string | null;
          end_code: string | null;
          // Séquestre Coligo Pay (mig 0145/0163)
          escrow_da: number;
          cash_due_da: number;
          card_failed_at: string | null;
        };
        Insert: {
          id?: string;
          customer_id: string;
          status?: string;
          pickup_lat: number;
          pickup_lng: number;
          dest_lat: number;
          dest_lng: number;
          [k: string]: unknown;
        };
        Update: Partial<Database["public"]["Tables"]["rides"]["Insert"]>;
        Relationships: [];
      };
      ride_offers: {
        Row: {
          id: string;
          ride_id: string;
          chauffeur_id: string;
          price_da: number;
          status: "offered" | "accepted" | "declined" | "expired";
          created_at: string;
        };
        Insert: {
          id?: string;
          ride_id: string;
          chauffeur_id: string;
          price_da: number;
          status?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["ride_offers"]["Insert"]>;
        Relationships: [];
      };
      ride_events: {
        Row: {
          id: string;
          ride_id: string;
          from_status: string | null;
          to_status: string | null;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          ride_id: string;
          from_status?: string | null;
          to_status?: string | null;
          note?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["ride_events"]["Insert"]>;
        Relationships: [];
      };
      ride_ledger: {
        Row: {
          id: string;
          chauffeur_id: string | null;
          ride_id: string | null;
          type:
            | "chauffeur_payout"
            | "chauffeur_owes_platform"
            | "chauffeur_cash_collected"
            | "adjustment";
          amount_da: number;
          note: string | null;
          settled_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          chauffeur_id?: string | null;
          ride_id?: string | null;
          type: string;
          amount_da: number;
          note?: string | null;
          settled_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["ride_ledger"]["Insert"]>;
        Relationships: [];
      };
      chauffeur_documents: {
        Row: {
          id: string;
          chauffeur_id: string;
          kind:
            | "permis_recto"
            | "permis_verso"
            | "carte_grise"
            | "plaque"
            | "assurance"
            | "selfie";
          url: string;
          created_at: string;
          // Mig 0148 : validation piÃ¨ce par piÃ¨ce
          status: "pending" | "approved" | "rejected";
          review_note: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
        };
        Insert: {
          id?: string;
          chauffeur_id: string;
          kind: string;
          url: string;
          created_at?: string;
          [k: string]: unknown;
        };
        Update: Partial<
          Database["public"]["Tables"]["chauffeur_documents"]["Insert"]
        >;
        Relationships: [];
      };
      chauffeur_subscriptions: {
        Row: {
          id: string;
          chauffeur_id: string;
          plan: "pro" | "premium";
          status: "pending_ccp" | "active" | "expired" | "cancelled";
          payment_method: "ccp" | "card";
          period_start: string | null;
          period_end: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          chauffeur_id: string;
          plan: string;
          status?: string;
          payment_method: string;
          period_start?: string | null;
          period_end?: string | null;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["chauffeur_subscriptions"]["Insert"]
        >;
        Relationships: [];
      };
      chauffeur_subscription_payments: {
        Row: {
          id: string;
          subscription_id: string;
          chauffeur_id: string;
          plan: "pro" | "premium";
          amount_da: number;
          method: "ccp" | "card";
          receipt_url: string | null;
          reference: string | null;
          status: "pending" | "approved" | "rejected";
          reviewed_by: string | null;
          reviewed_at: string | null;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          subscription_id: string;
          chauffeur_id: string;
          plan: string;
          amount_da: number;
          method: string;
          receipt_url?: string | null;
          reference?: string | null;
          status?: string;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          note?: string | null;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["chauffeur_subscription_payments"]["Insert"]
        >;
        Relationships: [];
      };
      customer_favorite_chauffeurs: {
        Row: {
          customer_id: string;
          chauffeur_id: string;
          created_at: string;
        };
        Insert: {
          customer_id: string;
          chauffeur_id: string;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["customer_favorite_chauffeurs"]["Insert"]
        >;
        Relationships: [];
      };
      ride_reports: {
        Row: {
          id: string;
          ride_id: string;
          reporter: "customer" | "chauffeur";
          reason: string;
          status: "open" | "reviewed" | "dismissed";
          decision: string | null;
          created_at: string;
          reviewed_at: string | null;
        };
        Insert: {
          id?: string;
          ride_id: string;
          reporter: string;
          reason: string;
          status?: string;
          decision?: string | null;
          created_at?: string;
          reviewed_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["ride_reports"]["Insert"]>;
        Relationships: [];
      };
      ride_messages: {
        Row: {
          id: string;
          ride_id: string;
          sender: "customer" | "chauffeur";
          body: string;
          created_at: string;
          delivered_at: string | null;
          read_at: string | null;
        };
        Insert: {
          id?: string;
          ride_id: string;
          sender: string;
          body: string;
          created_at?: string;
          delivered_at?: string | null;
          read_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["ride_messages"]["Insert"]>;
        Relationships: [];
      };
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
          payout_auto: string;
          payout_method: string | null;
          payout_details: string | null;
          last_auto_payout_at: string | null;
          auto_accept_orders: boolean;
          orders_paused: boolean;
          catalog_display: string;
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
          tags: string[];
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
          payout_auto?: string;
          payout_method?: string | null;
          payout_details?: string | null;
          last_auto_payout_at?: string | null;
          auto_accept_orders?: boolean;
          orders_paused?: boolean;
          catalog_display?: string;
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
          tags?: string[];
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
          payout_auto?: string;
          payout_method?: string | null;
          payout_details?: string | null;
          last_auto_payout_at?: string | null;
          auto_accept_orders?: boolean;
          orders_paused?: boolean;
          catalog_display?: string;
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
          tags?: string[];
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
          driver_fee_rate_applied: number | null;
          driver_fee_da: number | null;
          driver_net_da: number | null;
          driver_owes_platform_da: number | null;
          driver_owes_merchant_da: number | null;
          driver_cash_collected_da: number | null;
          delivery_failed_at: string | null;
          delivery_failed_reason: string | null;
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
          driver_fee_rate_applied?: number | null;
          driver_fee_da?: number | null;
          driver_net_da?: number | null;
          driver_owes_platform_da?: number | null;
          driver_owes_merchant_da?: number | null;
          driver_cash_collected_da?: number | null;
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
          driver_fee_rate_applied?: number | null;
          driver_fee_da?: number | null;
          driver_net_da?: number | null;
          driver_owes_platform_da?: number | null;
          driver_owes_merchant_da?: number | null;
          driver_cash_collected_da?: number | null;
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
          min_qty: number | null;
          max_qty: number | null;
          position: number;
          image_url: string | null;
          is_available: boolean;
          archived_at: string | null;
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
          min_qty?: number | null;
          max_qty?: number | null;
          position?: number;
          image_url?: string | null;
          is_available?: boolean;
          archived_at?: string | null;
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
          min_qty?: number | null;
          max_qty?: number | null;
          position?: number;
          image_url?: string | null;
          is_available?: boolean;
          archived_at?: string | null;
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
          unit: Database["public"]["Enums"]["product_unit"];
          name_ar: string | null;
          is_free: boolean;
          source_promotion_id: string | null;
        };
        Insert: {
          id?: string;
          order_id: string;
          product_name: string;
          unit_price_da: number;
          quantity: number;
          line_total_da: number;
          unit?: Database["public"]["Enums"]["product_unit"];
          name_ar?: string | null;
          is_free?: boolean;
          source_promotion_id?: string | null;
        };
        Update: {
          id?: string;
          order_id?: string;
          product_name?: string;
          unit_price_da?: number;
          quantity?: number;
          line_total_da?: number;
          unit?: Database["public"]["Enums"]["product_unit"];
          name_ar?: string | null;
          is_free?: boolean;
          source_promotion_id?: string | null;
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
      product_option_groups: {
        Row: {
          id: string;
          product_id: string;
          name_fr: string;
          name_ar: string | null;
          min_select: number;
          max_select: number;
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          name_fr: string;
          name_ar?: string | null;
          min_select?: number;
          max_select?: number;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          product_id?: string;
          name_fr?: string;
          name_ar?: string | null;
          min_select?: number;
          max_select?: number;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_option_groups_product_id_fkey";
            columns: ["product_id"];
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_options: {
        Row: {
          id: string;
          group_id: string;
          name_fr: string;
          name_ar: string | null;
          price_delta_da: number;
          is_available: boolean;
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          group_id: string;
          name_fr: string;
          name_ar?: string | null;
          price_delta_da?: number;
          is_available?: boolean;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          group_id?: string;
          name_fr?: string;
          name_ar?: string | null;
          price_delta_da?: number;
          is_available?: boolean;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_options_group_id_fkey";
            columns: ["group_id"];
            referencedRelation: "product_option_groups";
            referencedColumns: ["id"];
          },
        ];
      };
      order_item_options: {
        Row: {
          id: string;
          order_item_id: string;
          group_name_fr: string;
          group_name_ar: string | null;
          option_name_fr: string;
          option_name_ar: string | null;
          price_delta_da: number;
          position: number;
        };
        Insert: {
          id?: string;
          order_item_id: string;
          group_name_fr: string;
          group_name_ar?: string | null;
          option_name_fr: string;
          option_name_ar?: string | null;
          price_delta_da?: number;
          position?: number;
        };
        Update: {
          id?: string;
          order_item_id?: string;
          group_name_fr?: string;
          group_name_ar?: string | null;
          option_name_fr?: string;
          option_name_ar?: string | null;
          price_delta_da?: number;
          position?: number;
        };
        Relationships: [
          {
            foreignKeyName: "order_item_options_order_item_id_fkey";
            columns: ["order_item_id"];
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
        ];
      };
      order_promotions: {
        Row: {
          id: string;
          order_id: string;
          promotion_id: string | null;
          type: string;
          title_fr: string;
          title_ar: string | null;
          code: string | null;
          discount_da: number;
          free_qty: number;
          position: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          promotion_id?: string | null;
          type: string;
          title_fr: string;
          title_ar?: string | null;
          code?: string | null;
          discount_da?: number;
          free_qty?: number;
          position?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          promotion_id?: string | null;
          type?: string;
          title_fr?: string;
          title_ar?: string | null;
          code?: string | null;
          discount_da?: number;
          free_qty?: number;
          position?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_promotions_order_id_fkey";
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
          min_subtotal_da: number | null;
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
          min_subtotal_da?: number | null;
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
          min_subtotal_da?: number | null;
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
          coligo_pay_payment_id: string | null;
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
          coligo_pay_payment_id?: string | null;
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
          coligo_pay_payment_id?: string | null;
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
          ranking_unified: boolean;
          // Drive (mig 0139)
          drive_pricing: Json;
          drive_night_coef: number;
          drive_night_start_h: number;
          drive_night_end_h: number;
          drive_floor_rate: number;
          drive_price_step_da: number;
          drive_boost_min_da: number;
          drive_boost_step_da: number;
          drive_boost_default_rate: number;
          drive_cashback_rate: number;
          drive_female_filter_enabled: boolean;
          drive_newcustomer_enabled: boolean;
          drive_newcustomer_rate: number;
          drive_scheduled_enabled: boolean;
          drive_paid_plans_enabled: boolean;
          drive_scheduled_lead_min: number;
          drive_scheduled_max_days: number;
          drive_freeze_debt_da: number;
          drive_freeze_cancel_rate: number;
          drive_freeze_cancel_window: number;
          drive_freeze_min_rating: number;
          drive_freeze_rating_window: number;
          drive_plan_pro_fee_da: number;
          drive_plan_pro_rate: number;
          drive_plan_premium_fee_da: number;
          drive_plan_premium_rate: number;
          drive_sub_grace_days: number;
          drive_sub_week_factor: number;
          drive_sub_2week_factor: number;
          drive_ccp_number: string;
          drive_ccp_key: string;
          drive_ccp_name: string;
          drive_home_dir_max_per_day: number;
          drive_home_dir_tolerance_deg: number;
          drive_request_ttl_min: number;
          drive_offer_ttl_min: number;
          drive_b2b_radius_km: number;
          drive_b2b_ttl_sec: number;
          drive_pickup_wait_min: number;
          drive_deviation_km: number;
          drive_deviation_min: number;
          delivery_base_da: number;
          delivery_per_km_da: number;
          delivery_free_km_threshold: number;
          delivery_min_da: number;
          delivery_max_da: number;
          delivery_max_radius_km: number;
          driver_fee_rate: number;
          driver_fee_cap_rate: number;
          driver_fee_min_da: number;
          driver_float_cap_da: number;
          driver_settlement_cycle: "weekly" | "monthly";
          tour_delivery_commission_rate: number;
          vtc_base_da: number;
          vtc_per_km_da: number;
          vtc_min_da: number;
          vtc_commission_rate: number;
          // SPEC-COLIGO-PAY (mig 0205)
          tour_discount_rate: number;
          cashback_consumption_estimate: number;
          sub_priority_monthly_da: number;
          sub_priority_first_month_da: number;
          withdrawal_fee_tiers: Json;
          p2p_enabled: boolean;
          withdrawal_daily_cap_da: number;
          withdrawal_sliding_cap_da: number;
          withdrawal_sliding_days: number;
          dispatch_priority_delay_sec: number;
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
          ranking_unified?: boolean;
          delivery_base_da?: number;
          delivery_per_km_da?: number;
          delivery_free_km_threshold?: number;
          delivery_min_da?: number;
          delivery_max_da?: number;
          delivery_max_radius_km?: number;
          driver_fee_rate?: number;
          driver_fee_cap_rate?: number;
          driver_fee_min_da?: number;
          driver_float_cap_da?: number;
          driver_settlement_cycle?: "weekly" | "monthly";
          tour_delivery_commission_rate?: number;
          vtc_commission_rate?: number;
          updated_at?: string;
          [k: string]: unknown;
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
          ranking_unified?: boolean;
          delivery_base_da?: number;
          delivery_per_km_da?: number;
          delivery_free_km_threshold?: number;
          delivery_min_da?: number;
          delivery_max_da?: number;
          delivery_max_radius_km?: number;
          driver_fee_rate?: number;
          driver_fee_cap_rate?: number;
          driver_fee_min_da?: number;
          driver_float_cap_da?: number;
          driver_settlement_cycle?: "weekly" | "monthly";
          tour_delivery_commission_rate?: number;
          vtc_commission_rate?: number;
          updated_at?: string;
          [k: string]: unknown;
        };
        Relationships: [];
      };
      platform_config_registry: {
        Row: {
          key: string;
          value_type: "rate" | "number" | "da" | "json" | "bool";
          group_key: string;
          label_fr: string;
          label_ar: string;
          help_fr: string | null;
          help_ar: string | null;
          sort_order: number;
          min_num: number | null;
          max_num: number | null;
          step_num: number | null;
          json_shape: Json | null;
          is_active: boolean;
          updated_at: string;
        };
        Insert: { key: string; value_type: string; group_key: string; label_fr: string; label_ar: string; [k: string]: unknown };
        Update: { [k: string]: unknown };
        Relationships: [];
      };
      platform_settings_history: {
        Row: {
          id: string;
          changed_at: string;
          changed_by: string | null;
          changed_by_email: string | null;
          before_data: Json | null;
          after_data: Json | null;
        };
        Insert: { [k: string]: unknown };
        Update: { [k: string]: unknown };
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
          vehicle_label: string | null;
          vehicle_plate: string | null;
          payout_method: string | null;
          payout_details: string | null;
          joined_year: number | null;
          vehicle_type: string | null;
          vehicle_brand: string | null;
          vehicle_model: string | null;
          vehicle_color: string | null;
          vehicle_year: number | null;
          national_id_number: string | null;
          id_card_number: string | null;
          date_of_birth: string | null;
          address: string | null;
          is_verified: boolean;
          verified_at: string | null;
          verified_by: string | null;
          admin_note: string | null;
          avatar_url: string | null;
          is_blocked: boolean;
          blocked_at: string | null;
          block_reason: string | null;
          frozen_at: string | null;
          freeze_reason: string | null;
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
          vehicle_label?: string | null;
          vehicle_plate?: string | null;
          payout_method?: string | null;
          payout_details?: string | null;
          joined_year?: number | null;
          vehicle_type?: string | null;
          vehicle_brand?: string | null;
          vehicle_model?: string | null;
          vehicle_color?: string | null;
          vehicle_year?: number | null;
          national_id_number?: string | null;
          id_card_number?: string | null;
          date_of_birth?: string | null;
          address?: string | null;
          is_verified?: boolean;
          verified_at?: string | null;
          verified_by?: string | null;
          admin_note?: string | null;
          avatar_url?: string | null;
          is_blocked?: boolean;
          blocked_at?: string | null;
          block_reason?: string | null;
          frozen_at?: string | null;
          freeze_reason?: string | null;
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
          vehicle_label?: string | null;
          vehicle_plate?: string | null;
          payout_method?: string | null;
          payout_details?: string | null;
          joined_year?: number | null;
          vehicle_type?: string | null;
          vehicle_brand?: string | null;
          vehicle_model?: string | null;
          vehicle_color?: string | null;
          vehicle_year?: number | null;
          national_id_number?: string | null;
          id_card_number?: string | null;
          date_of_birth?: string | null;
          address?: string | null;
          is_verified?: boolean;
          verified_at?: string | null;
          verified_by?: string | null;
          admin_note?: string | null;
          avatar_url?: string | null;
          is_blocked?: boolean;
          blocked_at?: string | null;
          block_reason?: string | null;
          frozen_at?: string | null;
          freeze_reason?: string | null;
        };
        Relationships: [];
      };
      driver_documents: {
        Row: {
          id: string;
          driver_id: string;
          doc_type: string;
          number: string | null;
          issued_at: string | null;
          expires_at: string | null;
          file_url: string | null;
          note: string | null;
          status: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          review_note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          driver_id: string;
          doc_type: string;
          number?: string | null;
          issued_at?: string | null;
          expires_at?: string | null;
          file_url?: string | null;
          note?: string | null;
          status?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          review_note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          driver_id?: string;
          doc_type?: string;
          number?: string | null;
          issued_at?: string | null;
          expires_at?: string | null;
          file_url?: string | null;
          note?: string | null;
          status?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          review_note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      driver_payout_methods: {
        Row: {
          id: string;
          driver_id: string;
          method: string;
          label: string | null;
          account_number: string | null;
          account_name: string | null;
          is_default: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          driver_id: string;
          method: string;
          label?: string | null;
          account_number?: string | null;
          account_name?: string | null;
          is_default?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          driver_id?: string;
          method?: string;
          label?: string | null;
          account_number?: string | null;
          account_name?: string | null;
          is_default?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      email_change_throttle: {
        Row: {
          user_id: string;
          fails: number;
          lock_level: number;
          locked_until: string | null;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          fails?: number;
          lock_level?: number;
          locked_until?: string | null;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          fails?: number;
          lock_level?: number;
          locked_until?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      driver_change_requests: {
        Row: {
          id: string;
          driver_id: string;
          kind: string;
          note: string;
          payload: Json | null;
          status: string;
          review_note: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          applied_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          driver_id: string;
          kind: string;
          note: string;
          payload?: Json | null;
          status?: string;
          review_note?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          applied_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          driver_id?: string;
          kind?: string;
          note?: string;
          payload?: Json | null;
          status?: string;
          review_note?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          applied_at?: string | null;
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
      order_messages: {
        Row: {
          id: string;
          order_id: string;
          sender_role: "customer" | "courier";
          sender_user_id: string;
          code: string;
          created_at: string;
          read_at: string | null;
        };
        Insert: {
          id?: string;
          order_id: string;
          sender_role: "customer" | "courier";
          sender_user_id: string;
          code: string;
          created_at?: string;
          read_at?: string | null;
        };
        Update: {
          id?: string;
          order_id?: string;
          sender_role?: "customer" | "courier";
          sender_user_id?: string;
          code?: string;
          created_at?: string;
          read_at?: string | null;
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
      drive_price_learning: {
        Row: {
          zone: string;
          band: number;
          coef: number;
          signal: number;
          n_obs: number;
          updated_at: string;
        };
        Insert: {
          zone: string;
          band: number;
          coef?: number;
          signal?: number;
          n_obs?: number;
          updated_at?: string;
        };
        Update: {
          zone?: string;
          band?: number;
          coef?: number;
          signal?: number;
          n_obs?: number;
          updated_at?: string;
        };
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
          phone: string | null;
          email: string | null;
          default_wilaya_code: string | null;
          default_commune: string | null;
          latitude: number | null;
          longitude: number | null;
          created_at: string;
          updated_at: string;
          // Drive (mig 0139)
          is_female_verified: boolean;
          sos_contacts: unknown;
        };
        Insert: {
          id?: string;
          user_id: string;
          full_name: string;
          phone?: string | null;
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
          [k: string]: unknown;
          phone?: string | null;
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
          role: "merchant" | "customer" | "courier" | "chauffeur";
          token: string;
          platform: "android" | "ios" | "web";
          created_at: string;
          last_seen_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          role: "merchant" | "customer" | "courier" | "chauffeur";
          token: string;
          platform: "android" | "ios" | "web";
          created_at?: string;
          last_seen_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          role?: "merchant" | "customer" | "courier" | "chauffeur";
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
      merchant_tour_schedule: {
        Row: {
          id: string;
          merchant_id: string;
          weekday: number;
          start_time: string;
          end_time: string;
          max_orders: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          merchant_id: string;
          weekday: number;
          start_time: string;
          end_time: string;
          max_orders: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          merchant_id?: string;
          weekday?: number;
          start_time?: string;
          end_time?: string;
          max_orders?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      merchant_delivery_zones: {
        Row: {
          id: string;
          merchant_id: string;
          band_index: number;
          max_km: number;
          price_da: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          merchant_id: string;
          band_index: number;
          max_km: number;
          price_da: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          merchant_id?: string;
          band_index?: number;
          max_km?: number;
          price_da?: number;
          created_at?: string;
          updated_at?: string;
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
            | "adjustment"
            | "driver_advance_refund";
          amount_da: number;
          note: string | null;
          created_at: string;
          statement_id: string | null;
          settled_at: string | null;
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
            | "adjustment"
            | "driver_advance_refund";
          amount_da: number;
          note?: string | null;
          created_at?: string;
          statement_id?: string | null;
          settled_at?: string | null;
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
            | "adjustment"
            | "driver_advance_refund";
          amount_da?: number;
          note?: string | null;
          created_at?: string;
          statement_id?: string | null;
          settled_at?: string | null;
        };
        Relationships: [];
      };
      driver_refund_claims: {
        Row: {
          id: string;
          order_id: string;
          driver_id: string;
          merchant_id: string | null;
          customer_id: string | null;
          advance_da: number;
          reason: string;
          status: "pending" | "approved" | "rejected";
          goods_decision:
            | "return_to_merchant"
            | "driver_keeps"
            | "give_away"
            | null;
          admin_note: string | null;
          resolved_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          driver_id: string;
          merchant_id?: string | null;
          customer_id?: string | null;
          advance_da: number;
          reason?: string;
          status?: "pending" | "approved" | "rejected";
          goods_decision?:
            | "return_to_merchant"
            | "driver_keeps"
            | "give_away"
            | null;
          admin_note?: string | null;
          resolved_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          driver_id?: string;
          merchant_id?: string | null;
          customer_id?: string | null;
          advance_da?: number;
          reason?: string;
          status?: "pending" | "approved" | "rejected";
          goods_decision?:
            | "return_to_merchant"
            | "driver_keeps"
            | "give_away"
            | null;
          admin_note?: string | null;
          resolved_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      driver_statements: {
        Row: {
          id: string;
          driver_id: string;
          period_start: string;
          period_end: string;
          deliveries_count: number;
          gross_driver_da: number;
          commission_da: number;
          service_fee_da: number;
          driver_fee_da: number;
          cashback_provisioned_da: number;
          to_reverse_da: number;
          to_receive_da: number;
          net_da: number;
          direction: "reverse" | "receive" | "settled";
          status: "open" | "due" | "paid";
          method: string | null;
          details: string | null;
          due_at: string | null;
          settled_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          driver_id: string;
          period_start: string;
          period_end: string;
          deliveries_count?: number;
          gross_driver_da?: number;
          commission_da?: number;
          service_fee_da?: number;
          driver_fee_da?: number;
          cashback_provisioned_da?: number;
          to_reverse_da?: number;
          to_receive_da?: number;
          net_da?: number;
          direction?: "reverse" | "receive" | "settled";
          status?: "open" | "due" | "paid";
          method?: string | null;
          details?: string | null;
          due_at?: string | null;
          settled_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          driver_id?: string;
          period_start?: string;
          period_end?: string;
          deliveries_count?: number;
          gross_driver_da?: number;
          commission_da?: number;
          service_fee_da?: number;
          driver_fee_da?: number;
          cashback_provisioned_da?: number;
          to_reverse_da?: number;
          to_receive_da?: number;
          net_da?: number;
          direction?: "reverse" | "receive" | "settled";
          status?: "open" | "due" | "paid";
          method?: string | null;
          details?: string | null;
          due_at?: string | null;
          settled_at?: string | null;
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
          catalog_display: string;
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
      ensure_merchant_delivery_zones: {
        Args: { p_merchant_id: string };
        Returns: undefined;
      };
      ensure_tour_slots: {
        Args: { p_merchant_id: string };
        Returns: undefined;
      };
      platform_delivery_fee_da: {
        Args: { p_km: number };
        Returns: number;
      };
      tour_delivery_fee_da: {
        Args: { p_merchant_id: string; p_distance_km: number };
        Returns: number;
      };
      driver_outstanding: {
        Args: { p_driver_id: string };
        Returns: number;
      };
      driver_can_accept: {
        Args: { p_driver_id: string };
        Returns: boolean;
      };
      drive_recompute_learning: {
        Args: Record<string, never>;
        Returns: number;
      };
      recharge_points_nearby: {
        Args: {
          p_lat: number;
          p_lng: number;
          p_limit?: number;
          p_radius_override?: number | null;
        };
        Returns: {
          wallet_id: string;
          display_name: string | null;
          address: string | null;
          phone: string | null;
          hours: string | null;
          lat: number;
          lng: number;
          distance_km: number;
        }[];
      };
      recharge_points_exist: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      my_operator_wallet: {
        Args: Record<string, never>;
        Returns: string | null;
      };
      operator_topup_config: {
        Args: Record<string, never>;
        Returns: {
          ccp_number: string | null;
          ccp_key: string | null;
          ccp_name: string | null;
          bank_name: string | null;
          bank_rib: string | null;
          presets_da: number[];
          max_da: number;
        }[];
      };
      my_operator_wallet_state: {
        Args: Record<string, never>;
        Returns: {
          wallet_id: string;
          owner_type: string;
          status: string;
          balance_da: number;
          debt_da: number;
          effective_balance_da: number;
          neg_threshold_da: number;
          can_operate: boolean;
          is_partner: boolean;
        }[];
      };
      my_operator_wallet_entries: {
        Args: { p_limit?: number };
        Returns: {
          type: string;
          amount_da: number;
          note: string | null;
          created_at: string;
        }[];
      };
      request_operator_topup: {
        Args: { p_method: string; p_amount_da: number; p_proof_url: string };
        Returns: string;
      };
      my_partner_stats: {
        Args: Record<string, never>;
        Returns: {
          balance_da: number;
          total_topup_da: number;
          total_sold_da: number;
          total_bonus_da: number;
          sales_count: number;
        }[];
      };
      coligo_recharge_sell: {
        Args: {
          p_target_wallet_id: string;
          p_amount_da: number;
          p_pin: string;
          p_op_id: string;
        };
        Returns: Record<string, unknown>;
      };
      find_operator_wallet_by_phone: {
        Args: { p_phone: string };
        Returns: {
          wallet_id: string;
          owner_type: string;
          name: string | null;
          status: string;
        }[];
      };
      operator_set_pin: {
        Args: { p_pin: string };
        Returns: Record<string, unknown>;
      };
      operator_pin_status: {
        Args: Record<string, never>;
        Returns: Record<string, unknown>;
      };
      operator_verify_pin: {
        Args: { p_pin: string };
        Returns: Record<string, unknown>;
      };
      generate_driver_statements: {
        Args: { p_period_start: string; p_period_end: string };
        Returns: { statements_created: number; drivers_total: number }[];
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
      my_priority_state: { Args: Record<string, never>; Returns: Json };
      priority_subscribe: { Args: { p_payment_method: string }; Returns: Json };
      priority_sub_cancel: { Args: Record<string, never>; Returns: Json };
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
      send_order_message: {
        Args: { p_order_id: string; p_code: string };
        Returns: {
          ok: boolean;
          reason: string | null;
          sender_role: "customer" | "courier" | null;
        }[];
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
