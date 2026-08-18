/*
Author       : Dreamstechnologies
Template Name: Dreams Food - Bootstrap Template
Version      : 1.0
*/

(function ($) {
	"use strict";

	var $wrapper = $('.main-wrapper');
	
	// Sidebar

	if ($(window).width() <= 991) {
		var Sidemenu = function () {
			this.$menuItem = $('.main-nav a');
		};

		function init() {
			var $this = Sidemenu;
			$('.main-nav a').on('click', function (e) {
				if ($(this).parent().hasClass('has-submenu')) {
					e.preventDefault();
				}
				if (!$(this).hasClass('submenu')) {
					$('ul', $(this).parents('ul:first')).slideUp(350);
					$('a', $(this).parents('ul:first')).removeClass('submenu');
					$(this).next('ul').slideDown(350);
					$(this).addClass('submenu');
				} else if ($(this).hasClass('submenu')) {
					$(this).removeClass('submenu');
					$(this).next('ul').slideUp(350);
				}
			});
		}

		// Sidebar Initiate
		init();
	}

       
	/* ==================================================
		# Smooth Scroll
		===============================================*/
	
	// Sticky Header
	
	$(window).scroll(function () {
		var sticky = $('.header'),
			scroll = $(window).scrollTop();
		if (scroll >= 50) sticky.addClass('fixed');
		else sticky.removeClass('fixed');
	});

	// Mobile menu sidebar overlay
	
	$('.header-fixed').append('<div class="sidebar-overlay"></div>');
	$(document).on('click', '#mobile_btn', function () {
		$('main-wrapper').toggleClass('slide-nav');
		$('.sidebar-overlay').toggleClass('opened');
		$('html').addClass('menu-opened');
		return false;
	});


	$(document).on('click', '.sidebar-overlay', function () {
		$('html').removeClass('menu-opened');
		$(this).removeClass('opened');
		$('main-wrapper').removeClass('slide-nav');
		$('#task_window').removeClass('opened');
	});

	$(document).on('click', '#menu_close', function () {
		$('html').removeClass('menu-opened');
		$('.sidebar-overlay').removeClass('opened');
		$('main-wrapper').removeClass('slide-nav');
	});
	
	// Small Sidebar

	$(document).on('click', '#toggle_btn', function () {
		if ($('body').hasClass('mini-sidebar')) {
			$('body').removeClass('mini-sidebar');
			$('.subdrop + ul').slideDown();
		} else {
			$('body').addClass('mini-sidebar');
			$('.subdrop + ul').slideUp();
		}
		return false;
	});


	$(document).on('mouseover', function (e) {
		e.stopPropagation();
		if ($('body').hasClass('mini-sidebar') && $('#toggle_btn').is(':visible')) {
			var targ = $(e.target).closest('.sidebar').length;
			if (targ) {
				$('body').addClass('expand-menu');
				$('.subdrop + ul').slideDown();
			} else {
				$('body').removeClass('expand-menu');
				$('.subdrop + ul').slideUp();
			}
			return false;
		}
	});

	// Mobile menu sidebar overlay

	$('body').append('<div class="sidebar-overlay"></div>');
	$(document).on('click', '#mobile_btns', function () {
		$wrapper.toggleClass('slide-nav');
		$('.sidebar-overlay').toggleClass('opened');
		$('html').toggleClass('menu-opened');
		return false;
	});

	// Sidebar

	var Sidemenu = function () {
		this.$menuItem = $('#sidebar-menu a');
	};

	function initi() {
		var $this = Sidemenu;
		$('#sidebar-menu a').on('click', function (e) {
			if ($(this).parent().hasClass('submenu')) {
				e.preventDefault();
			}
			if (!$(this).hasClass('subdrop')) {
				$('ul', $(this).parents('ul:first')).slideUp(350);
				$('a', $(this).parents('ul:first')).removeClass('subdrop');
				$(this).next('ul').slideDown(350);
				$(this).addClass('subdrop');
			} else if ($(this).hasClass('subdrop')) {
				$(this).removeClass('subdrop');
				$(this).next('ul').slideUp(350);
			}
		});
		$('#sidebar-menu ul li.submenu a.active').parents('li:last').children('a:first').addClass('active').trigger('click');
	}

	// Sidebar Initiate
	initi();	
	
	// CURSOR
	function mim_tm_cursor() {

		var myCursor = jQuery('.mouse-cursor');

		if (myCursor.length) {
			if ($("body")) {

				const e = document.querySelector(".cursor-inner"),
					t = document.querySelector(".cursor-outer");
				let n, i = 0,
					o = !1;
				window.onmousemove = function (s) {
					o || (t.style.transform = "translate(" + s.clientX + "px, " + s.clientY + "px)"), e.style.transform = "translate(" + s.clientX + "px, " + s.clientY + "px)", n = s.clientY, i = s.clientX
				}, $("body").on("mouseenter", "a, .cursor-pointer", function () {
					e.classList.add("cursor-hover"), t.classList.add("cursor-hover")
				}), $("body").on("mouseleave", "a, .cursor-pointer", function () {
					$(this).is("a") && $(this).closest(".cursor-pointer").length || (e.classList.remove("cursor-hover"), t.classList.remove("cursor-hover"))
				}), e.style.visibility = "visible", t.style.visibility = "visible"
			}
		}
	};
	mim_tm_cursor()

	$(window).scroll(function() { 
        var scroll = $(window).scrollTop();
        if (scroll >= 500) {
         $(".back-to-top-icon").addClass("show");
        } else {
         $(".back-to-top-icon").removeClass("show");
        }
     });

	// counter
	if($('.counterUp').length > 0) {
		$('.counterUp').counterUp({
				delay: 15,
				time: 1500
			});
	}	
	
	// Lazy loding
	document.addEventListener("DOMContentLoaded", function() {
		let lazyImages = [].slice.call(document.querySelectorAll("img.lazy"));
		let active = false;

		const lazyLoad = function() {
			if (active === false) {
				active = true;

				setTimeout(function() {
					lazyImages.forEach(function(lazyImage) {
						if ((lazyImage.getBoundingClientRect().top <= window.innerHeight && lazyImage.getBoundingClientRect().bottom >= 0) && getComputedStyle(lazyImage).display !== "none") {
							lazyImage.src = lazyImage.dataset.src;
							lazyImage.classList.remove("lazy");

							lazyImages = lazyImages.filter(function(image) {
								return image !== lazyImage;
							});

							if (lazyImages.length === 0) {
								document.removeEventListener("scroll", lazyLoad);
								window.removeEventListener("resize", lazyLoad);
								window.removeEventListener("orientationchange", lazyLoad);
							}
						}
					});

					active = false;
				}, 200);
			}
		};

		document.addEventListener("scroll", lazyLoad);
		window.addEventListener("resize", lazyLoad);
		window.addEventListener("orientationchange", lazyLoad);
	});

	// Vertical Slide (Infinite Scroll)
		document.addEventListener("DOMContentLoaded", function () {
		document.querySelectorAll(".vertical-slide").forEach(scroller => {
			scroller.setAttribute("data-animated", true);

			const scrollerInner = scroller.querySelector(".slide-list");
			const scrollerContent = Array.from(scrollerInner.children);

			// Clone each item to create the infinite loop
			scrollerContent.forEach(item => {
			const clone = item.cloneNode(true);
			clone.setAttribute("aria-hidden", "true");
			scrollerInner.appendChild(clone);
			});
		});
	});

	// Horizontal Slide (Infinite Scroll)
	document.addEventListener("DOMContentLoaded", function () {
		document.querySelectorAll(".horizontal-slide").forEach(scroller => {
			const scrollerInner = scroller.querySelector(".slide-list");
			const scrollerContent = Array.from(scrollerInner.children);

			// Clone enough items to fill twice
			scrollerContent.forEach(item => {
				const clone = item.cloneNode(true);
				clone.setAttribute("aria-hidden", true);
				scrollerInner.appendChild(clone);
			});

			let scrollPos = 0;
			const speed = 1; // pixels per frame, adjust as needed

			function animate() {
				scrollPos += speed;
				if (scrollPos >= scrollerContent[0].offsetWidth + 20) { // width + margin
					// Move first item to end
					scrollerInner.appendChild(scrollerInner.firstElementChild);
					scrollPos = 0;
				}
				scrollerInner.style.transform = `translateX(-${scrollPos}px)`;
				requestAnimationFrame(animate);
			}

			animate();
		});
	});


	// Modules Scroll
		const modules = document.querySelectorAll('.module-item');

		window.addEventListener('scroll', () => {
		const scrollY = window.scrollY;
		const windowH = window.innerHeight;

		modules.forEach((item, index) => {
			const speed = 0.15 * (index + 1);
			const translateY = scrollY * speed;
			const opacity = Math.max(0, 1 - scrollY / (windowH * (index + 0.8)));

			item.style.transform = `translateY(-${translateY}px) rotate(${(index - 2) * 1.2}deg)`;
			item.style.opacity = opacity;
		});
	});

	// Iframe 
	jQuery(document).ready(function($){
		if (window!=window.top) {
			window.top.location.href = window.location.href;
		}
	});	

	// clarity
	(function(c,l,a,r,i,t,y){
		c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
		t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
		y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
	})(window, document, "clarity", "script", "ru83d0mlom");

})(jQuery);

	

