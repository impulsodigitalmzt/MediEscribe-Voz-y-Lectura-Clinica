"""
ExportService — PDF generation from finalized clinical notes.

Generates professionally formatted PDF documents containing:
- Full structured clinical note with all sections
- Patient demographic header
- Physician identification
- AI-generated content disclaimer
- Timestamps for generation and sign-off
- Page numbers and professional formatting
- Digital signature block / approval indicator
"""

import io
import logging
from datetime import datetime, timezone
from typing import Dict, Any, Optional
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT

logger = logging.getLogger(__name__)


class ExportError(Exception):
    pass


class ExportService:
    """PDF generation service for finalized clinical notes."""

    # MedScribe brand colors
    TEAL = colors.HexColor("#0D9488")
    DARK_TEAL = colors.HexColor("#0F766E")
    LIGHT_GRAY = colors.HexColor("#F3F4F6")
    DARK_GRAY = colors.HexColor("#374151")
    RED_FLAG = colors.HexColor("#DC2626")

    def generate_pdf(
        self,
        note: Dict[str, Any],
        encounter: Dict[str, Any],
        physician: Dict[str, Any],
        patient_info: Dict[str, str],
    ) -> bytes:
        """
        Generate a professionally formatted PDF from a clinical note.

        Args:
            note: Clinical note sections and metadata
            encounter: Encounter details (ID, dates, template)
            physician: Physician details (name, credentials, specialty, institution)
            patient_info: Decrypted patient demographics

        Returns:
            PDF file as bytes
        """
        buffer = io.BytesIO()

        doc = SimpleDocTemplate(
            buffer,
            pagesize=letter,
            rightMargin=0.75 * inch,
            leftMargin=0.75 * inch,
            topMargin=0.75 * inch,
            bottomMargin=0.75 * inch,
            title="Clinical Note — MedScribe",
            author=physician.get("full_name", ""),
        )

        styles = self._build_styles()
        story = []

        # --- Header ---
        story.extend(self._build_header(styles, encounter, physician, patient_info))
        story.append(Spacer(1, 12))

        # --- AI Disclaimer ---
        story.append(self._build_disclaimer(styles, note))
        story.append(Spacer(1, 12))

        # --- Note Sections ---
        section_labels = {
            "chief_complaint": "Chief Complaint",
            "hpi": "History of Present Illness",
            "past_medical_history": "Past Medical History",
            "medications": "Medications",
            "allergies": "Allergies",
            "family_history": "Family History",
            "social_history": "Social History",
            "review_of_systems": "Review of Systems",
            "physical_examination": "Physical Examination",
            "assessment": "Assessment",
            "plan": "Plan",
            "follow_up": "Follow-up Instructions",
        }

        missing_sections = note.get("missing_sections", [])
        uncertain_fields = note.get("uncertain_fields", [])

        for section_key, section_label in section_labels.items():
            content = note.get(section_key, "")
            is_missing = section_key in missing_sections
            is_uncertain = section_key in uncertain_fields

            story.extend(
                self._build_section(
                    styles, section_label, content,
                    is_missing=is_missing,
                    is_uncertain=is_uncertain
                )
            )

        # --- Signature Block ---
        story.append(Spacer(1, 24))
        story.extend(self._build_signature_block(styles, note, physician))

        # --- Footer with timestamps ---
        story.append(Spacer(1, 12))
        story.extend(self._build_footer(styles, note, encounter))

        # Build PDF
        doc.build(story, onFirstPage=self._add_page_number, onLaterPages=self._add_page_number)

        pdf_bytes = buffer.getvalue()
        buffer.close()

        logger.info(f"PDF generated: {len(pdf_bytes)} bytes")
        return pdf_bytes

    def _build_styles(self) -> Dict[str, ParagraphStyle]:
        """Build custom paragraph styles for the PDF."""
        base_styles = getSampleStyleSheet()

        styles = {
            "title": ParagraphStyle(
                "CustomTitle",
                parent=base_styles["Heading1"],
                fontSize=18,
                textColor=self.DARK_TEAL,
                spaceAfter=4,
                alignment=TA_CENTER,
                fontName="Helvetica-Bold",
            ),
            "subtitle": ParagraphStyle(
                "CustomSubtitle",
                parent=base_styles["Normal"],
                fontSize=10,
                textColor=self.DARK_GRAY,
                alignment=TA_CENTER,
                spaceAfter=8,
            ),
            "section_header": ParagraphStyle(
                "SectionHeader",
                parent=base_styles["Heading2"],
                fontSize=12,
                textColor=self.DARK_TEAL,
                spaceBefore=12,
                spaceAfter=4,
                fontName="Helvetica-Bold",
                borderWidth=0,
                borderPadding=0,
            ),
            "body": ParagraphStyle(
                "BodyText",
                parent=base_styles["Normal"],
                fontSize=10,
                leading=14,
                textColor=self.DARK_GRAY,
                spaceAfter=6,
            ),
            "missing": ParagraphStyle(
                "MissingText",
                parent=base_styles["Normal"],
                fontSize=10,
                textColor=colors.gray,
                fontName="Helvetica-Oblique",
            ),
            "uncertain": ParagraphStyle(
                "UncertainText",
                parent=base_styles["Normal"],
                fontSize=10,
                textColor=colors.HexColor("#B45309"),
                fontName="Helvetica-Oblique",
            ),
            "disclaimer": ParagraphStyle(
                "Disclaimer",
                parent=base_styles["Normal"],
                fontSize=9,
                textColor=self.RED_FLAG,
                alignment=TA_CENTER,
                spaceBefore=8,
                spaceAfter=8,
                borderWidth=1,
                borderColor=self.RED_FLAG,
                borderPadding=8,
            ),
            "small": ParagraphStyle(
                "SmallText",
                parent=base_styles["Normal"],
                fontSize=8,
                textColor=colors.gray,
            ),
            "signature": ParagraphStyle(
                "Signature",
                parent=base_styles["Normal"],
                fontSize=10,
                textColor=self.DARK_GRAY,
                spaceBefore=4,
            ),
        }
        return styles

    def _build_header(
        self,
        styles: Dict,
        encounter: Dict,
        physician: Dict,
        patient_info: Dict
    ) -> list:
        """Build the document header with patient and physician info."""
        elements = []

        # Title
        elements.append(Paragraph("CLINICAL NOTE", styles["title"]))
        elements.append(Paragraph("MedScribe — AI-Powered Clinical Documentation", styles["subtitle"]))
        elements.append(HRFlowable(width="100%", color=self.TEAL, thickness=2))
        elements.append(Spacer(1, 8))

        # Patient and encounter info table
        header_data = [
            [
                Paragraph(f"<b>Patient:</b> {patient_info.get('patient_name', 'N/A')}", styles["body"]),
                Paragraph(f"<b>Encounter ID:</b> {encounter.get('encounter_id', 'N/A')}", styles["body"]),
            ],
            [
                Paragraph(f"<b>DOB:</b> {patient_info.get('patient_dob', 'N/A')}", styles["body"]),
                Paragraph(f"<b>Date:</b> {encounter.get('date', 'N/A')}", styles["body"]),
            ],
            [
                Paragraph(f"<b>MRN:</b> {patient_info.get('patient_mrn', 'N/A')}", styles["body"]),
                Paragraph(f"<b>Template:</b> {encounter.get('specialty_template', 'N/A')}", styles["body"]),
            ],
        ]
        header_table = Table(header_data, colWidths=[3.5 * inch, 3.5 * inch])
        header_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ]))
        elements.append(header_table)

        # Physician info
        elements.append(Spacer(1, 4))
        physician_line = (
            f"<b>Physician:</b> {physician.get('full_name', 'N/A')}, "
            f"{physician.get('credentials', '')}"
        )
        if physician.get("specialty"):
            physician_line += f" | {physician['specialty']}"
        if physician.get("institution"):
            physician_line += f" | {physician['institution']}"
        elements.append(Paragraph(physician_line, styles["body"]))

        elements.append(HRFlowable(width="100%", color=self.LIGHT_GRAY, thickness=1))

        return elements

    def _build_disclaimer(self, styles: Dict, note: Dict) -> Paragraph:
        """Build the AI-generated content disclaimer."""
        disclaimer_text = note.get(
            "ai_disclaimer",
            "This note was generated by AI and requires physician review before finalization."
        )
        return Paragraph(
            f"⚠ {disclaimer_text}",
            styles["disclaimer"]
        )

    def _build_section(
        self,
        styles: Dict,
        label: str,
        content: Any,
        is_missing: bool = False,
        is_uncertain: bool = False
    ) -> list:
        """Build a single note section."""
        elements = []
        elements.append(Paragraph(label.upper(), styles["section_header"]))

        if is_missing or not content or content == "[NOT DISCUSSED]":
            elements.append(Paragraph(
                "[Not discussed during encounter]",
                styles["missing"]
            ))
        elif isinstance(content, dict):
            # Handle JSON sections (ROS, PE)
            for sub_key, sub_val in content.items():
                sub_label = sub_key.replace("_", " ").title()
                elements.append(Paragraph(
                    f"<b>{sub_label}:</b> {sub_val}",
                    styles["uncertain"] if is_uncertain else styles["body"]
                ))
        else:
            style = styles["uncertain"] if is_uncertain else styles["body"]
            prefix = "[UNCERTAIN] " if is_uncertain else ""
            # Handle multi-line content
            for line in str(content).split("\n"):
                if line.strip():
                    elements.append(Paragraph(f"{prefix}{line.strip()}", style))

        return elements

    def _build_signature_block(
        self,
        styles: Dict,
        note: Dict,
        physician: Dict
    ) -> list:
        """Build the physician signature and approval block."""
        elements = []
        elements.append(HRFlowable(width="100%", color=self.DARK_GRAY, thickness=1))
        elements.append(Spacer(1, 8))

        signed = note.get("signed_off_at")
        if signed:
            elements.append(Paragraph(
                f"✓ SIGNED AND APPROVED",
                ParagraphStyle(
                    "ApprovedText",
                    fontSize=11,
                    textColor=self.DARK_TEAL,
                    fontName="Helvetica-Bold",
                )
            ))
            elements.append(Paragraph(
                f"Electronically signed by: {physician.get('full_name', '')}, "
                f"{physician.get('credentials', '')}",
                styles["signature"]
            ))
            elements.append(Paragraph(
                f"Sign-off timestamp: {signed}",
                styles["small"]
            ))
        else:
            elements.append(Paragraph(
                "⚠ DRAFT — NOT YET SIGNED",
                ParagraphStyle(
                    "DraftText",
                    fontSize=11,
                    textColor=self.RED_FLAG,
                    fontName="Helvetica-Bold",
                )
            ))

        return elements

    def _build_footer(self, styles: Dict, note: Dict, encounter: Dict) -> list:
        """Build footer with timestamps and metadata."""
        elements = []
        elements.append(Spacer(1, 12))
        elements.append(HRFlowable(width="100%", color=self.LIGHT_GRAY, thickness=1))

        gen_time = note.get("generated_at", "N/A")
        elements.append(Paragraph(
            f"Note generated: {gen_time} | "
            f"Encounter duration: {encounter.get('duration_seconds', 0) // 60} min | "
            f"Document produced by MedScribe v1.0",
            styles["small"]
        ))

        return elements

    @staticmethod
    def _add_page_number(canvas, doc):
        """Add page numbers to each page."""
        page_num = canvas.getPageNumber()
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.gray)
        canvas.drawRightString(
            doc.pagesize[0] - 0.75 * inch,
            0.5 * inch,
            f"Page {page_num}"
        )
        canvas.drawString(
            0.75 * inch,
            0.5 * inch,
            "MedScribe — Confidential Clinical Document"
        )
        canvas.restoreState()


export_service = ExportService()
